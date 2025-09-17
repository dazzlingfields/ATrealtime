// This is a serverless function for Vercel.
// It acts as a proxy to securely call the AT API without exposing the API key on the client-side.
// It will be triggered by requests from your `script.js` file.

// The `module.exports` syntax is a standard way to export a function in a Node.js environment
// like Vercel's serverless functions.
module.exports = async (req, res) => {
    // --- CORS Configuration ---
    // This allows your GitHub Pages site to access this proxy.
    // Replace YOUR_GITHUB_USERNAME with your actual GitHub username.
    res.setHeader('Access-Control-Allow-Origin', 'https://atrealtime.github.io');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

    // Handle preflight requests, which are sent by the browser before the actual request.
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    // --- End CORS Configuration ---

    // 1. Get the API key from Vercel's environment variables.
    // This variable is securely stored on Vercel's servers.
    const atApiKey = process.env.AT_API_KEY;

    // 2. If the API key is not found, return an error.
    if (!atApiKey) {
        res.status(500).send('API key not configured on the server.');
        return;
    }

    // 3. Get the path from the incoming request URL (e.g., '/realtime', '/routes/12345').
    // The `req.url` will be something like '/api/realtime'. We need to remove the '/api' prefix.
    const apiPath = req.url.replace('/api/', '');

    // 4. Construct the full URL for the AT API.
    const apiUrl = `https://api.at.govt.nz/v2/${apiPath}`;

    // 5. Define the headers, including the secure API key.
    const headers = {
        'Ocp-Apim-Subscription-Key': atApiKey
    };

    // 6. Make the request to the official AT API on behalf of the client.
    try {
        const response = await fetch(apiUrl, { headers });
        const data = await response.json();

        // 7. Send the data back to the client (`script.js`).
        // We use the same status code as the AT API response.
        res.status(response.status).json(data);
    } catch (error) {
        // 8. Log and send an error response if something goes wrong.
        console.error('Proxy error:', error);
        res.status(500).send('An error occurred while fetching data from the AT API.');
    }
};
