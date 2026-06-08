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

// ذاكرة مؤقتة (Cache) لحفظ النتائج وتسريع البحث
const cache = new Map();
const CACHE_DURATION = 15 * 60 * 1000; // 15 دقيقة

// ترويسات متقدمة لتخطي الحظر قدر الإمكان
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
    
    if(results.length === 0) console.log('⚠️ حراج لم يرجع أي نتائج، قد يكون الآيبي محظوراً.');
    return results;
  } catch (error) {
    console.error('❌ خطأ حراج:', error.message);
    return [];
  }
}

// ─── سعودي سيل ───────────────────────────────────────
async function scrapeSaudiSale(query, page = 1) {
  const url = `https://cars.saudisale.com/listings?search=${encodeURIComponent(query)}&sort=date_desc&page=${page}`;
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(data);
    const results = [];

    $('.listing-card, a[href*="/listings/"]').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href');
      if (!href || !href.match(/\/listings\/[a-zA-Z0-9]+\//)) return;

      const title = $el.find('.listing-title, h2, h3').first().text().trim() || $el.attr('title') || '';
      if (!title || title.length < 4) return;

      results.push({
        source: 'saudisale',
        sourceName: 'سعودي سيل',
        title: title.replace(/\n/g, ' ').trim(),
        price: $el.find('.listing-price, .price').first().text().trim() || 'اسأل',
        city: $el.find('.listing-location, .city').first().text().trim() || '',
        km: $el.find('.listing-mileage, .km').first().text().trim() || '',
        time: '',
        url: href.startsWith('http') ? href : 'https://cars.saudisale.com' + href,
        img: $el.find('img').first().attr('src') || '',
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

  // فحص الذاكرة المؤقتة (إذا بحثت عن نفس الكلمة يتم عرض النتيجة فوراً بدون انتظار)
  const cacheKey = `${query}-${page}`;
  if (cache.has(cacheKey)) {
    const cachedData = cache.get(cacheKey);
    if (Date.now() - cachedData.timestamp < CACHE_DURATION) {
      console.log('⚡ تم جلب النتائج بسرعة من الذاكرة المؤقتة');
      return res.json(cachedData.data);
    }
    cache.delete(cacheKey); // مسح البيانات إذا انتهت صلاحيتها
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
    errors: merged.length === 0 ? ['ملاحظة: السيرفر محظور حالياً من قبل الموقع، يرجى التشغيل على شبكة منزلية.'] : []
  };

  // حفظ في الذاكرة المؤقتة
  cache.set(cacheKey, { timestamp: Date.now(), data: responseData });
  res.json(responseData);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ السيرفر شغّال وجاهز على المنفذ: ${PORT}`);
});
