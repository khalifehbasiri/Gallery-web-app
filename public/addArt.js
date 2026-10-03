function add_art() {
  return withButton(document.getElementById('Aadd'), async () => {
    const artwork = readFields('A', [
      'name',
      'year',
      'category',
      'medium',
      'description',
    ]);
    const image = document.getElementById('Aimage').files[0];
    if (!image) throw new Error('Choose an image first.');
    if (image.size > 5 * 1024 * 1024)
      throw new Error('Images must be 5 MB or smaller.');
    const body = new FormData();
    for (const [field, value] of Object.entries(artwork))
      body.append(field, value);
    body.append('image', image);
    await request('/addArt', body);
    location.href = '/account';
  });
}
