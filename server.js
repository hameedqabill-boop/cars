const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const cache = new Map();
const CACHE_DURATION = 15 * 60 * 1000;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'ar,en-US;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1'
};

// ─── 1. حراج ────────────────────────────────────────────
async function scrapeHaraj(query, page = 1) {
  const url = `https://haraj.com.sa/search/${encodeURIComponent(query)}/?page=${page}`;
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(data);
    const results = [];

    $('[data-testid="post-item"], .post, .post-item, a[href*="/post/"]').each((_, el) => {
      const $el = $(el);
      const title = $el.find('[data-testid="post-title"], .title, h2, h3').first().text().trim() || $el.text().trim();
      const href = $el.attr('href') || $el.find('a').first().attr('href');
      
      if (!title || title.length < 4 || !href) return;

      results.push({
        source: 'haraj',
        sourceName: 'حراج',
        title: title.replace(/\n/g, ' ').trim(),
        price: $el.find('[data-testid="post-price"], .price').first().text().trim() || 'اسأل',
        city: $el.find('[data-testid="post-city"], .city').first().text().trim() || '',
        time: $el.find('[data-testid="post-date"], .date').first().text().trim() || '',
        url: href.startsWith('http') ? href : 'https://haraj.com.sa' + href,
        img: $el.find('img').first().attr('src') || '',
      });
    });
    return results;
  } catch (error) {
    return [];
  }
}

// ─── 2. السوق المفتوح (OpenSooq) ────────────────────────
async function scrapeOpenSooq(query, page = 1) {
  const url = `https://sa.opensooq.com/ar/%D8%B3%D9%8A%D8%A7%D8%B1%D8%A7%D8%AA-%D9%88%D9%85%D8%B1%D9%83%D8%A8%D8%A7%D8%AA/%D8%B3%D9%8A%D8%A7%D8%B1%D8%A7%D8%AA-%D9%84%D9%84%D8%A8%D9%8A%D8%B9?term=${encodeURIComponent(query)}`;
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(data);
    const results = [];

    $('a[href*="/ar/search/"], a[href*="/ar/post/"], .mb-32').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href') || $el.find('a').first().attr('href');
      
      if (!href || href.includes('search?')) return;

      let title = $el.find('h2, h3, [class*="title"]').first().text().trim() || $el.attr('title') || $el.text().trim();
      if (!title || title.length < 3) return;

      results.push({
        source: 'opensooq',
        sourceName: 'السوق المفتوح',
        title: title.replace(/\n/g, ' ').trim(),
        price: $el.find('[class*="price"]').first().text().trim() || 'اسأل',
        city: $el.find('[class*="city"], [class*="location"]').first().text().trim() || '',
        km: '',
        time: '',
        url: href.startsWith('http') ? href : 'https://sa.opensooq.com' + href,
        img: $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src') || '',
      });
    });
    return results;
  } catch (error) {
    return [];
  }
}

// ─── 3. يلا موتور (YallaMotor) ──────────────────────────
async function scrapeYallaMotor(query, page = 1) {
  const url = `https://ksa.yallamotor.com/ar/used-cars/search?keyword=${encodeURIComponent(query)}`;
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(data);
    const results = [];

    $('a[href*="/ar/used-cars/"]').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href');
      
      if (!href || href.includes('/search')) return;

      let title = $el.find('h2, h3, [class*="title"]').first().text().trim() || $el.attr('title') || $el.text().trim();
      if (!title || title.length < 3) return;

      results.push({
        source: 'yallamotor',
        sourceName: 'يلا موتور',
        title: title.replace(/\n/g, ' ').trim(),
        price: $el.find('[class*="price"]').first().text().trim() || 'اسأل',
        city: $el.find('[class*="city"], [class*="location"]').first().text().trim() || '',
        km: $el.find('[class*="km"], [class*="mileage"]').first().text().trim() || '',
        time: '',
        url: href.startsWith('http') ? href : 'https://ksa.yallamotor.com' + href,
        img: $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src') || '',
      });
    });
    return results;
  } catch (error) {
    return [];
  }
}

// ─── مسار البحث ────────────────────────────────────────────
app.post('/api/search', async (req, res) => {
  const { query, page = 1, source } = req.body;
  if (!query) return res.status(400).json({ error: 'الرجاء إدخال كلمة البحث' });

  const cacheKey = `${query}-${page}-${source || 'all'}`;
  if (cache.has(cacheKey)) {
    const cachedData = cache.get(cacheKey);
    if (Date.now() - cachedData.timestamp < CACHE_DURATION) {
      return res.json(cachedData.data);
    }
    cache.delete(cacheKey);
  }

  let harajPromise = null;
  let opensooqPromise = null;
  let yallamotorPromise = null;

  if (source === 'opensooq') {
    opensooqPromise = scrapeOpenSooq(query, page);
  } else if (source === 'haraj') {
    harajPromise = scrapeHaraj(query, page);
  } else if (source === 'yallamotor') {
    yallamotorPromise = scrapeYallaMotor(query, page);
  } else {
    harajPromise = scrapeHaraj(query, page);
    opensooqPromise = scrapeOpenSooq(query, page);
    yallamotorPromise = scrapeYallaMotor(query, page);
  }

  const [harajResults, opensooqResults, yallamotorResults] = await Promise.allSettled([
    harajPromise || Promise.resolve([]),
    opensooqPromise || Promise.resolve([]),
    yallamotorPromise || Promise.resolve([]),
  ]);

  const haraj = harajResults.status === 'fulfilled' ? harajResults.value : [];
  const opensooq = opensooqResults.status === 'fulfilled' ? opensooqResults.value : [];
  const yallamotor = yallamotorResults.status === 'fulfilled' ? yallamotorResults.value : [];

  const merged = [];
  const seen = new Set();
  
  for (const item of [...haraj, ...opensooq, ...yallamotor]) {
    const key = item.title.slice(0, 30).toLowerCase();
    if (!seen.has(key)) { seen.add(key); merged.push(item); }
  }

  const responseData = {
    total: merged.length,
    harajCount: haraj.length,
    opensooqCount: opensooq.length,
    yallamotorCount: yallamotor.length,
    results: merged,
    errors: []
  };

  cache.set(cacheKey, { timestamp: Date.now(), data: responseData });
  res.json(responseData);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ السيرفر شغّال وجاهز على المنفذ: ${PORT}`);
});
