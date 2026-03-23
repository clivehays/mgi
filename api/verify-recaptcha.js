module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    var token = req.body && req.body.token;
    if (!token) {
        return res.status(400).json({ success: false, error: 'Missing token' });
    }

    var secret = process.env.RECAPTCHA_SECRET_KEY;
    if (!secret) {
        return res.status(500).json({ success: false, error: 'Server misconfigured' });
    }

    try {
        var response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'secret=' + encodeURIComponent(secret) + '&response=' + encodeURIComponent(token)
        });
        var data = await response.json();

        if (data.success && data.score >= 0.5) {
            return res.status(200).json({ success: true, score: data.score });
        } else {
            return res.status(403).json({ success: false, score: data.score || 0, error: 'Failed verification' });
        }
    } catch (err) {
        return res.status(500).json({ success: false, error: 'Verification request failed' });
    }
};
