import WebScraper from './webScraper';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const scraper = new WebScraper({
    baseUrl: process.env.SCRAPE_BASE_URL!,
    supabaseUrl: process.env.SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_KEY!,
    bucket: process.env.SCRAPE_BUCKET_NAME!,
    removeJS: true,
    addBaseURL: true
  });

  const urlsToScrape = [
    
  ];


  const results = await scraper.batchScrape(urlsToScrape);
  console.log('Scraping results:', results);
}

main().catch(console.error);