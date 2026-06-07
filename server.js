const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Accept-Language': 'ar,en-US;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

// ─── حراج ────────────────────────────────────────────
async function scrapeHaraj(query, page = 1) {
  const encoded = encodeURIComponent(query);
  const url = `https://haraj.com.sa/search/${encoded}/?page=${page}`;
  const { data } = await axios.get(url, { headers: HEADERS, timeout: 10000 });
  const $ = cheerio.load(data);
  const results = [];

  $('div[class*="postItem"], article[class*="post"], .post-card, [data-post-id]').each((_, el) => {
    const $el = $(el);
    const title = $el.find('h2, h3, .post-title, [class*="title"]').first().text().trim();
    const price = $el.find('[class*="price"]').first().text().trim();
    const city  = $el.find('[class*="city"], [class*="location"]').first().text().trim();
    const href  = $el.find('a').first().attr('href');
    const img   = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src');
    const time  = $el.find('[class*="time"], [class*="date"], time').first().text().trim();

    if (!title) return;

    results.push({
      source: 'haraj',
      sourceName: 'حراج',
      title,
      price: price || 'اسأل',
      city: city || '',
      time: time || '',
      url: href ? (href.startsWith('http') ? href : 'https://haraj.com.sa' + href) : '',
      img: img || '',
    });
  });

  // fallback: generic card selector
  if (results.length === 0) {
    $('a[href*="/post/"], a[href*="/listing/"]').each((_, el) => {
      const $el = $(el);
      const title = $el.text().trim();
      const href  = $el.attr('href');
      if (!title || title.length < 5) return;
      results.push({
        source: 'haraj',
        sourceName: 'حراج',
        title,
        price: 'اسأل',
        city: '',
        time: '',
        url: href.startsWith('http') ? href : 'https://haraj.com.sa' + href,
        img: '',
      });
    });
  }

  return results;
}

// ─── سعودي سيل ───────────────────────────────────────
async function scrapeSaudiSale(query, page = 1) {
  const encoded = encodeURIComponent(query);
  const url = `https://cars.saudisale.com/listings?search=${encoded}&sort=date_desc&page=${page}`;
  const { data } = await axios.get(url, { headers: HEADERS, timeout: 10000 });
  const $ = cheerio.load(data);
  const results = [];

  $('a[href*="/listings/"]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    // skip non-listing links like /listings?...
    if (!href || !href.match(/\/listings\/[a-zA-Z0-9]+\//)) return;

    const title = $el.find('h2, h3, [class*="title"], [class*="name"]').first().text().trim()
                || $el.attr('title') || '';
    const price = $el.find('[class*="price"]').first().text().trim();
    const city  = $el.find('[class*="city"], [class*="location"]').first().text().trim();
    const img   = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src') || '';
    const km    = $el.find('[class*="mileage"], [class*="km"]').first().text().trim();

    if (!title || title.length < 5) return;

    results.push({
      source: 'saudisale',
      sourceName: 'سعودي سيل',
      title,
      price: price || 'اسأل',
      city: city || '',
      km: km || '',
      time: '',
      url: href.startsWith('http') ? href : 'https://cars.saudisale.com' + href,
      img,
    });
  });

  return results;
}

// ─── Route ────────────────────────────────────────────
app.post('/api/search', async (req, res) => {
  const { query, page = 1 } = req.body;
  if (!query) return res.status(400).json({ error: 'query مطلوب' });

  const [harajResults, saudiSaleResults] = await Promise.allSettled([
    scrapeHaraj(query, page),
    scrapeSaudiSale(query, page),
  ]);

  const haraj     = harajResults.status === 'fulfilled'     ? harajResults.value     : [];
  const saudisale = saudiSaleResults.status === 'fulfilled' ? saudiSaleResults.value : [];

  // errors
  const errors = [];
  if (harajResults.status     === 'rejected') errors.push('حراج: ' + harajResults.reason?.message);
  if (saudiSaleResults.status === 'rejected') errors.push('سعودي سيل: ' + saudiSaleResults.reason?.message);

  // merge & deduplicate by title
  const merged = [];
  const seen   = new Set();
  for (const item of [...haraj, ...saudisale]) {
    const key = item.title.slice(0, 40).toLowerCase();
    if (!seen.has(key)) { seen.add(key); merged.push(item); }
  }

  res.json({
    total: merged.length,
    harajCount: haraj.length,
    saudiSaleCount: saudisale.length,
    results: merged,
    errors,
  });
});

app.listen(PORT, () => {
  console.log(`✅ السيرفر شغّال على http://localhost:${PORT}`);
  console.log(`   حراج + سعودي سيل جاهزين`);
});
