document.getElementById('accType').addEventListener('click', function () {
  return withButton(this, async () => {
    await request('/accType', {});
    location.href = '/account';
  });
});
