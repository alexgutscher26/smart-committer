require('dotenv').config();

const fetch = global.fetch || require('node-fetch');

const apiKey = process.env.CLAUDE_API_KEY;
const url = 'https://api.anthropic.com/v1/messages';

async function testClaude() {
  if (!apiKey) {
    console.error('CLAUDE_API_KEY not found in environment.');
    process.exit(1);
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 10,
        messages: [
          { role: 'user', content: 'Say hello.' }
        ]
      })
    });
    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Response:', text);
  } catch (err) {
    console.error('Network error:', err);
    process.exit(1);
  }
}

testClaude();
