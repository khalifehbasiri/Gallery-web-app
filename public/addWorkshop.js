function add_workshop() {
  return withButton(document.getElementById('Wadd'), async () => {
    const workshop = readFields('W', ['name', 'goal', 'duration']);
    await request('/addWorkshop', workshop);
    location.href = '/account';
  });
}
