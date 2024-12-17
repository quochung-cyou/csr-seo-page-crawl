import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { URL } from 'url';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'scraper.log' })
  ]
});

puppeteer.use(StealthPlugin());

interface ScraperConfig {
  baseUrl: string;
  supabaseUrl: string;
  supabaseKey: string;
  bucket: string;
  removeJS?: boolean;
  addBaseURL?: boolean;
}

class WebScraper {
  private config: ScraperConfig;
  private supabaseClient;

  constructor(config: ScraperConfig) {
    this.config = config;
    this.supabaseClient = createClient(config.supabaseUrl, config.supabaseKey);
  }

  private extractUrlPath(url: string): string {
    try {
      const parsedUrl = new URL(url);
      let cleanPath = parsedUrl.hostname.replace(/\./g, '-');
      const pathSegments = parsedUrl.pathname
        .split('/')
        .filter(segment => segment && segment.length > 0);
      
      if (pathSegments.length > 0) {
        cleanPath += `-${pathSegments.join('-')}`;
      }
  
      // Truncate to a reasonable length and sanitize
      return cleanPath
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .substring(0, 100);
    } catch (error) {
      logger.error(`Error extracting path from URL ${url}: ${error}`);
      return crypto.createHash('md5').update(url).digest('hex');
    }
  }

  private processHTML(html: string, url: string): string {
    let processedHTML = html;
  
    if (this.config.removeJS) {
      logger.info('Removing JavaScript from scraped content');
      processedHTML = processedHTML.replace(
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        ""
      );
    }
  
    const charsetMeta = `<meta charset="utf-8">`;
    if (!processedHTML.match(/<meta\s+charset=["']?utf-8["']?\s*\/?>/i)) {
      processedHTML = processedHTML.replace(
        /<head>/i, 
        `<head>${charsetMeta}`
      );
    }
  
    if (this.config.addBaseURL) {
      const parsedUrl = new URL(url);
      logger.info(`Adding base URL: ${parsedUrl.origin}`);
      processedHTML = processedHTML.replace(
        /<head>/gi, 
        `<head><base href="${parsedUrl.origin}">`
      );
    }
  
    return processedHTML;
  }

  /**
   * Scrape a given URL and store in Supabase
   * @param url - URL to scrape
   * @returns URL path or null if failed
   */
  async scrape(url: string): Promise<string | null> {
    logger.info(`Starting scrape for URL: ${url}`);
    let browser = null;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage'
        ],
        timeout: 30000
      });

      const page = await browser.newPage();
      
      await page.setDefaultNavigationTimeout(45000);
      await page.setDefaultTimeout(30000);
      await page.setExtraHTTPHeaders({
        'Accept-Charset': 'utf-8'
      });

      await page.evaluate(() => {
        const metaCharset = document.createElement('meta');
        metaCharset.setAttribute('charset', 'utf-8');
        document.head.insertBefore(metaCharset, document.head.firstChild);
      });

      // Optionally block resource-heavy content
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const resourceType = req.resourceType();
        const blockList = ['image', 'stylesheet', 'font'];
        if (blockList.includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      // Navigate and wait for network to be idle
      logger.info(`Navigating to URL: ${url}`);
      await page.goto(url, { 
        waitUntil: ['networkidle0', 'domcontentloaded'] 
      });

      // Extract full HTML
      const html = await page.evaluate(() => document.documentElement.outerHTML);
      
      // Process HTML
      const processedHTML = this.processHTML(html, url);
      
      // Upload to Supabase storage
      logger.info(`Uploading to Supabase bucket: ${this.config.bucket}`);
      const parsedUrl = new URL(url);
      const siteId = crypto.createHash('md5').update(parsedUrl.hostname).digest('hex');
      const urlPath = `${siteId}/${parsedUrl.hostname}${parsedUrl.pathname}`.replace(/\/+/g, '/');
    
      // Upload to Supabase with a consistent path structure
      const { data, error } = await this.supabaseClient.storage
        .from(this.config.bucket)
        .upload(`cache/${urlPath}.html`, processedHTML, {
          contentType: 'text/html',
          upsert: true
        });

      if (error) {
        logger.error(`Supabase upload error for ${url}: ${JSON.stringify(error)}`);
        return null;
      }

      logger.info(`Successfully scraped and uploaded: ${url} -> ${urlPath}`);
      
      await browser.close();
      return urlPath;

    } catch (error) {
      logger.error(`Scraping error for ${url}: ${error}`);
      return null;
    } finally {
      if (browser) await browser.close();
    }
  }

  /**
   * Batch scrape multiple URLs
   * @param urls - Array of URLs to scrape
   * @returns Array of URL paths
   */
  async batchScrape(urls: string[]): Promise<(string | null)[]> {
    logger.info(`Starting batch scrape for ${urls.length} URLs`);
    const results = await Promise.all(urls.map(url => this.scrape(url)));
    
    const successfulScrapes = results.filter(result => result !== null);
    logger.info(`Batch scrape completed. Successful: ${successfulScrapes.length}/${urls.length}`);
    
    return results;
  }


}

export default WebScraper;