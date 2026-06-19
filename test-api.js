const http = require('http');

// Test login status
console.log('Checking login status...');
const req1 = http.request('http://localhost:3000/api/login-status', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
}, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('Login status response:', data);
  });
});
req1.end();
