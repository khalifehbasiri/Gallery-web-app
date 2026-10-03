document.getElementById('submit').addEventListener('click', async function () {
  const error = document.getElementById('error');
  error.textContent = '';
  this.disabled = true;
  try {
    const username = document.getElementById('name').value.trim();
    const password = document.getElementById('pass').value;
    if (!username) throw new Error('Enter a username.');
    if (password.length < 8)
      throw new Error('Password must contain at least 8 characters.');
    await request('/register', { username, password });
    location.href = '/home';
  } catch (failure) {
    error.textContent =
      failure.message || 'Could not connect to the server. Please try again.';
  } finally {
    this.disabled = false;
  }
});
