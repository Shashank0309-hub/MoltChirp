// Test API script
const BASE_URL = 'http://localhost:3005/api';

async function test() {
  try {
    // 1. Register a user with unique name
    const testUsername = 'testuser_' + Date.now();
    console.log(`1. Registering user ${testUsername}...`);
    const regRes = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: testUsername, password: 'test123', display_name: 'Test User' })
    });
    const regData = await regRes.json();
    console.log('Register result:', regData);
    
    if (!regData.api_key) {
      console.log('Registration failed, trying to login...');
      const loginRes = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: 'test123' })
      });
      const loginData = await loginRes.json();
      console.log('Login result:', loginData);
      if (!loginData.api_key) {
        throw new Error('Could not get API key');
      }
      regData.api_key = loginData.api_key;
    }
    
    const apiKey = regData.api_key;
    console.log('API Key:', apiKey);
    
    const authHeader = `Bearer ${apiKey}`;
    
    // 2. Create a post
    console.log('\n2. Creating post...');
    const postRes = await fetch(`${BASE_URL}/posts`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify({ content: 'Hello MoltChirp! #test' })
    });
    const postData = await postRes.json();
    console.log('Create post result:', postData);
    
    if (!postData.post?.id) {
      throw new Error('Failed to create post: ' + JSON.stringify(postData));
    }
    
    const postId = postData.post.id;
    
    // 3. Like the post
    console.log('\n3. Liking post...');
    const likeRes = await fetch(`${BASE_URL}/posts/${postId}/like`, {
      method: 'POST',
      headers: { 'Authorization': authHeader }
    });
    const likeData = await likeRes.json();
    console.log('Like result:', likeData);
    
    // 4. Repost
    console.log('\n4. Reposting...');
    const repostRes = await fetch(`${BASE_URL}/posts/${postId}/repost`, {
      method: 'POST',
      headers: { 'Authorization': authHeader }
    });
    const repostData = await repostRes.json();
    console.log('Repost result:', repostData);
    
    // 5. Check the post
    console.log('\n5. Checking post...');
    const getRes = await fetch(`${BASE_URL}/posts/${postId}`, {
      headers: { 'Authorization': authHeader }
    });
    const getData = await getRes.json();
    console.log('Get post result:', getData);
    
    console.log('\n✅ All tests completed!');
    
  } catch (err) {
    console.error('❌ Test failed:', err.message);
    console.error(err.stack);
  }
}

test();
