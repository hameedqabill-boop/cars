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

// ─── 2. موقع سيارة (Syarah) ─────────────────────────────
async function scrapeSyarah(query, page = 1) {
  const url = `https://syarah.com/cars?keyword=${encodeURIComponent(query)}`;
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(data);
    const results = [];

    $('a[href*="/cars/"]').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href');
      
      // تجاوز الروابط غير الخاصة بالإعلانات
      if (!href || href.includes('/brands') || href.includes('/tags')) return;

      let title = $el.find('h2, h3, .title, [class*="title"], .car-name').first().text().trim() || $el.attr('title') || $el.text().trim();
      if (!title || title.length < 3) return;

      results.push({
        source: 'syarah',
        sourceName: 'سيارة',
        title: title.replace(/\n/g, ' ').trim(),
        price: $el.find('.price, [class*="price"]').first().text().trim() || 'اسأل',
        city: $el.find('.city, .location, [class*="city"]').first().text().trim() || 'السعودية',
        km: $el.find('.km, .mileage, [class*="km"]').first().text().trim() || '',
        time: '',
        url: href.startsWith('http') ? href : 'https://syarah.com' + href,
        img: $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src') || '',
      });
    });
    return results;
  } catch (error) {
    return [];
  }
}

// ─── 3. موقع هتلاقي (Hatla2ee) ──────────────────────────
async function scrapeHatla2ee(query, page = 1) {
  const url = `https://ksa.hatla2ee.com/ar/car/search?q=${encodeURIComponent(query)}`;
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(data);
    const results = [];

    $('.CarItem, .carItem, .carList .item, a[href*="/car/"]').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href') || $el.find('a').first().attr('href');
      
      if (!href || href.includes('/search') || href.includes('/make') || href.includes('/city')) return;

      let title = $el.find('.make, .model, h2, h3, .title').first().text().trim() || $el.text().trim();
      if (!title || title.length < 3 || title.includes('سيارات')) return;

      results.push({
        source: 'hatla2ee',
        sourceName: 'هتلاقي',
        title: title.replace(/\n/g, ' ').trim(),
        price: $el.find('.price, .carPrice, [class*="price"]').first().text().trim() || 'اسأل',
        city: $el.find('.city, .location').first().text().trim() || '',
        km: $el.find('.km, .mileage').first().text().trim() || '',
        time: $el.find('.date, .time').first().text().trim() || '',
        url: href.startsWith('http') ? href : 'https://ksa.hatla2ee.com' + href,
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
  let syarahPromise = null;
  let hatla2eePromise = null;

  if (source === 'syarah') {
    syarahPromise = scrapeSyarah(query, page);
  } else if (source === 'haraj') {
    harajPromise = scrapeHaraj(query, page);
  } else if (source === 'hatla2ee') {
    hatla2eePromise = scrapeHatla2ee(query, page);
  } else {
    harajPromise = scrapeHaraj(query, page);
    syarahPromise = scrapeSyarah(query, page);
    hatla2eePromise = scrapeHatla2ee(query, page);
  }

  const [harajResults, syarahResults, hatla2eeResults] = await Promise.allSettled([
    harajPromise || Promise.resolve([]),
    syarahPromise || Promise.resolve([]),
    hatla2eePromise || Promise.resolve([]),
  ]);

  const haraj = harajResults.status === 'fulfilled' ? harajResults.value : [];
  const syarah = syarahResults.status === 'fulfilled' ? syarahResults.value : [];
  const hatla2ee = hatla2eeResults.status === 'fulfilled' ? hatla2eeResults.value : [];

  const merged = [];
  const seen = new Set();
  
  for (const item of [...haraj, ...syarah, ...hatla2ee]) {
    const key = item.title.slice(0, 30).toLowerCase();
    if (!seen.has(key)) { seen.add(key); merged.push(item); }
  }

  const responseData = {
    total: merged.length,
    harajCount: haraj.length,
    syarahCount: syarah.length,
    hatla2eeCount: hatla2ee.length,
    results: merged,
    errors: []
  };

  cache.set(cacheKey, { timestamp: Date.now(), data: responseData });
  res.json(responseData);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ السيرفر شغّال وجاهز على المنفذ: ${PORT}`);
});
