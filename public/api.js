async function request(url, body) {
  const formData = body instanceof FormData;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: formData ? {} : { 'Content-Type': 'application/json' },
      body: formData ? body : JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not connect to the server. Please try again.');
  }
  const json = response.headers
    .get('content-type')
    ?.includes('application/json');
  const data = json ? await response.json() : null;
  if (!response.ok)
    throw new Error(data?.error || 'The request could not be completed.');
  return data;
}

async function withButton(button, action) {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try {
    await action();
  } catch (error) {
    alert(
      error.message || 'Could not connect to the server. Please try again.',
    );
  } finally {
    if (button) button.disabled = false;
  }
}

function readFields(prefix, fields) {
  const values = {};
  for (const field of fields) {
    values[field] = document.getElementById(`${prefix}${field}`).value.trim();
    if (!values[field]) throw new Error(`Missing ${field} field.`);
  }
  return values;
}
