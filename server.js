const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
// استخدام المنفذ الخاص بمنصة Render أو 8080 محلياً
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// تحديث الترويسات لتبدو كمتصفح حقيقي وتتجنب حظر المواقع
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1'
};

// ─── حراج ────────────────────────────────────────────
async function scrapeHaraj(query, page = 1) {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://haraj.com.sa/search/${encoded}/?page=${page}`;
    console.log(`جارِ البحث في حراج: ${url}`);

    const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(data);
    const results = [];

    // محددات بحث جديدة تشمل تصميم حراج الحديث
    $('[data-testid="post-item"], .post, .post-item, a[href*="/post/"], a[href*="/listing/"]').each((_, el) => {
      const $el = $(el);
      const title = $el.find('h2, h3, [data-testid="post-title"], .title').first().text().trim() || $el.text().trim();
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

    console.log(`تم العثور على ${results.length} نتيجة في حراج`);
    return results;
  } catch (error) {
    console.error('خطأ في سحب بيانات حراج:', error.message);
    return [];
  }
}

// ─── سعودي سيل ───────────────────────────────────────
async function scrapeSaudiSale(query, page = 1) {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://cars.saudisale.com/listings?search=${encoded}&sort=date_desc&page=${page}`;
    console.log(`جارِ البحث في سعودي سيل: ${url}`);

    const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(data);
    const results = [];

    $('.listing-card, a[href*="/listings/"]').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href');
      
      if (!href || !href.match(/\/listings\/[a-zA-Z0-9]+\//)) return;

      const title = $el.find('h2, h3, .listing-title').first().text().trim() || $el.attr('title') || '';
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

    console.log(`تم العثور على ${results.length} نتيجة في سعودي سيل`);
    return results;
  } catch (error) {
    console.error('خطأ في سحب بيانات سعودي سيل:', error.message);
    return [];
  }
}

// ─── Route ────────────────────────────────────────────
app.post('/api/search', async (req, res) => {
  const { query, page = 1 } = req.body;
  if (!query) return res.status(400).json({ error: 'الرجاء إدخال كلمة البحث' });

  // تشغيل البحث في الموقعين بنفس الوقت لتسريع النتيجة
  const [harajResults, saudiSaleResults] = await Promise.allSettled([
    scrapeHaraj(query, page),
    scrapeSaudiSale(query, page),
  ]);

  const haraj     = harajResults.status === 'fulfilled' ? harajResults.value : [];
  const saudisale = saudiSaleResults.status === 'fulfilled' ? saudiSaleResults.value : [];

  // دمج النتائج وحذف الإعلانات المكررة بنفس العنوان
  const merged = [];
  const seen   = new Set();
  for (const item of [...haraj, ...saudisale]) {
    const key = item.title.slice(0, 30).toLowerCase();
    if (!seen.has(key)) { 
      seen.add(key); 
      merged.push(item); 
    }
  }

  res.json({
    total: merged.length,
    harajCount: haraj.length,
    saudiSaleCount: saudisale.length,
    results: merged,
    errors: []
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ السيرفر شغّال وجاهز للاستقبال على المنفذ: ${PORT}`);
});
