import crypto from 'crypto';

// Configuration
const CONFIG = {
    SUPABASE_STORAGE_URL: '',
    DOMAIN_NAME: '',
    CACHE_DURATION: 3600, // 1 hour in seconds
    LOCAL_HOSTS: ['localhost', '127.0.0.1']
} as const;

// Bot User Agents
const BOT_USER_AGENTS = [
    // Search Engine Bots
    'googlebot',
    'bingbot',
    'slurp',
    'duckduckbot',
    'baiduspider',
    'yandexbot',
    'sogou',
    'exabot',
    'facebot',

    // Social Media and Other Bots
    'twitterbot',
    'linkedinbot',
    'pinterestbot',
    'telegram',
    'applebot',
    'semrushbot',
    'mj12bot',
    'dotbot',
    'ahrefsbot',
    'rogerbot',
    'mediapartners-google',
    'adsbot-google',
] as const;

// Media file extensions to bypass caching
const MEDIA_EXTENSIONS = [
    '.jpg', '.jpeg', '.png', '.gif', '.bmp',
    '.svg', '.webp', '.ico', '.tiff', '.tif',
    '.mp4', '.mp3', '.wav', '.avi', '.mov',
    '.mkv', '.flv', '.wmv', '.css', '.xml',
    '.json'
] as const;

export default {
    async fetch(request: Request, env: any, ctx: any) {
        const url = new URL(request.url);

        const isMediaFile = MEDIA_EXTENSIONS.some(ext => 
            url.pathname.toLowerCase().endsWith(ext)
        );

        // If it's a media file, serve the request as is
        if (isMediaFile) {
            if (CONFIG.LOCAL_HOSTS.includes(url.hostname)) {
                return new Response('Localhost content', { status: 200 });
            }
            return fetch(request);
        }

        // Check if the request is from a bot
        const userAgent = request.headers.get('User-Agent') || '';
        const isBot = BOT_USER_AGENTS.some(bot => 
            userAgent.toLowerCase().includes(bot)
        );

        if (isBot) {
            try {
                const siteId = crypto
                    .createHash('md5')
                    .update(CONFIG.DOMAIN_NAME)
                    .digest('hex');
                const targetUrl = `${CONFIG.SUPABASE_STORAGE_URL}cache/${siteId}/${CONFIG.DOMAIN_NAME}${url.pathname}.html`;
                const response = await fetch(targetUrl);
                if (response.ok) {
                    return new Response(response.body, {
                        status: response.status,
                        headers: {
                            'Content-Type': 'text/html',
                            'Cache-Control': `public, max-age=${CONFIG.CACHE_DURATION}`,
                            'X-Cached-Version': 'true',
                        },
                    });
                } else {
                    if (CONFIG.LOCAL_HOSTS.includes(url.hostname)) {
                        return new Response('Not found', { status: 404 });
                    }
                    return fetch(request);
                }
            } catch (error) {
                console.error('Error fetching cached content:', error);
                return fetch(request);
            }
        }

        return fetch(request);
    },
};
