const express = require('express');
const router = express.Router();

// Proxy GIF search to avoid CORS issues
router.get('/search', async (req, res) => {
  const query = req.query.q || '';
  const apiKey = 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ';
  
  try {
    const endpoint = query 
      ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${apiKey}&limit=20&media_filter=tinygif,gif`
      : `https://tenor.googleapis.com/v2/featured?key=${apiKey}&limit=20&media_filter=tinygif,gif`;
    
    const response = await fetch(endpoint);
    const data = await response.json();
    
    // Transform to simpler format
    const gifs = (data.results || []).map(gif => {
      const formats = gif.media_formats || {};
      return {
        id: gif.id,
        url: formats.gif?.url || formats.tinygif?.url || '',
        preview: formats.tinygif?.url || formats.gif?.url || '',
        title: gif.content_description || gif.title || ''
      };
    }).filter(g => g.url);
    
    res.json({ gifs });
  } catch (err) {
    console.error('GIF search error:', err);
    res.status(500).json({ error: 'Failed to search GIFs' });
  }
});

module.exports = router;
