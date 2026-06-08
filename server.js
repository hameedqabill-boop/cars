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

// ذاكرة مؤقتة لتسريع النتائج
const cache = new Map();
const CACHE_DURATION = 15 * 60 * 1000;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'ar,en-US;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1'
};

// ─── حراج ────────────────────────────────────────────
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
    console.error('❌ خطأ حراج:', error.message);
    return [];
  }
}

// ─── سعودي سيل ───────────────────────────────────────
async function scrapeSaudiSale(query, page = 1) {
  const url = `https://cars.saudisale.com/listings?search=${encodeURIComponent(query)}&page=${page}`;
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(data);
    const results = [];

    // بحث شامل عن أي رابط إعلان سيارة في الصفحة
    $('a[href*="/listings/"]').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href');
      
      // تخطي الروابط العامة والتأكد من أنه رابط إعلان فعلي
      if (!href || href.endsWith('/listings') || href.endsWith('/listings/')) return;

      // سحب العنوان بذكاء من أي عنصر نصي متوفر
      let title = $el.find('h2, h3, h4, [class*="title"], [class*="name"]').first().text().trim();
      if (!title) title = $el.attr('title') || '';
      
      if (!title || title.length < 4) return;

      results.push({
        source: 'saudisale',
        sourceName: 'سعودي سيل',
        title: title.replace(/\n/g, ' ').trim(),
        price: $el.find('[class*="price"]').first().text().trim() || 'اسأل',
        city: $el.find('[class*="city"], [class*="location"]').first().text().trim() || '',
        km: $el.find('[class*="km"], [class*="mileage"]').first().text().trim() || '',
        time: '',
        url: href.startsWith('http') ? href : 'https://cars.saudisale.com' + href,
        img: $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src') || '',
      });
    });
    return results;
  } catch (error) {
    console.error('❌ خطأ سعودي سيل:', error.message);
    return [];
  }
}

// ─── مسار البحث ────────────────────────────────────────────
app.post('/api/search', async (req, res) => {
  const { query, page = 1 } = req.body;
  if (!query) return res.status(400).json({ error: 'الرجاء إدخال كلمة البحث' });

  const cacheKey = `${query}-${page}`;
  if (cache.has(cacheKey)) {
    const cachedData = cache.get(cacheKey);
    if (Date.now() - cachedData.timestamp < CACHE_DURATION) {
      return res.json(cachedData.data);
    }
    cache.delete(cacheKey);
  }

  const [harajResults, saudiSaleResults] = await Promise.allSettled([
    scrapeHaraj(query, page),
    scrapeSaudiSale(query, page),
  ]);

  const haraj = harajResults.status === 'fulfilled' ? harajResults.value : [];
  const saudisale = saudiSaleResults.status === 'fulfilled' ? saudiSaleResults.value : [];

  const merged = [];
  const seen = new Set();
  
  for (const item of [...haraj, ...saudisale]) {
    const key = item.title.slice(0, 30).toLowerCase();
    if (!seen.has(key)) { seen.add(key); merged.push(item); }
  }

  const responseData = {
    total: merged.length,
    harajCount: haraj.length,
    saudiSaleCount: saudisale.length,
    results: merged,
    errors: []
  };

  cache.set(cacheKey, { timestamp: Date.now(), data: responseData });
  res.json(responseData);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ السيرفر شغّال وجاهز على المنفذ: ${PORT}`);
});
