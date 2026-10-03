function search() {
  return withButton(document.getElementById('search'), async () => {
    const criteria = {};
    for (const field of ['name', 'artist', 'category']) {
      const value = document.getElementById(`S${field}`).value.trim();
      if (value) criteria[field] = value;
    }
    if (!Object.keys(criteria).length)
      throw new Error('Enter at least one search field.');
    await request('/searchArt', criteria);
    location.href = '/searchArt';
  });
}
