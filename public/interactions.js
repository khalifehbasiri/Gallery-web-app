function follow(id) {
  return withButton(document.getElementById('follow'), async () => {
    await request('/follow', { value: id });
    location.reload();
  });
}

function unfollow(username) {
  return withButton(document.getElementById('unfollow'), async () => {
    await request('/unfollow', { value: username });
    location.reload();
  });
}

function updateLike(index, liking) {
  const action = liking ? 'like' : 'unlike';
  const nextAction = liking ? 'unlike' : 'like';
  const button = document.getElementById(`${action}${index}`);
  return withButton(button, async () => {
    const data = await request(`/${action}`, { value: button.value });
    button.id = `${nextAction}${index}`;
    button.textContent = liking ? '♥' : '♡';
    button.setAttribute(
      'aria-label',
      liking ? 'Unlike artwork' : 'Like artwork',
    );
    button.onclick = () => updateLike(index, !liking);
    document.getElementById(`likeCount${index}`).textContent = data.numLikes;
  });
}

function like(index) {
  return updateLike(index, true);
}

function unlike(index) {
  return updateLike(index, false);
}

function addreview(index) {
  return withButton(document.getElementById(`rSubmit${index}`), async () => {
    const input = document.getElementById(`rInput${index}`);
    if (!input.value.trim()) throw new Error('Enter a review first.');
    const { review } = await request('/rsubmit', {
      value: input.value.trim(),
      id: document.getElementById(`yes${index}`).value,
    });
    const entry = document.createElement('div');
    entry.className = 'review-entry';
    entry.append('User: ');
    const link = document.createElement('a');
    link.href = `/artist/${review.userId}`;
    link.textContent = review.user;
    entry.append(link, document.createElement('br'));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'review-remove';
    remove.value = review.review;
    remove.dataset.reviewId = review.reviewId;
    remove.setAttribute('aria-label', 'Remove review');
    remove.textContent = 'X';
    remove.onclick = () => remove_Review(remove, index);
    entry.append(remove, ` ${review.review}`);
    document.getElementById(`reviews${index}`).append(entry);
    input.value = '';
  });
}

function remove_Review(button, index) {
  return withButton(button, async () => {
    await request('/rRemove', {
      value: button.value,
      id: document.getElementById(`yes${index}`).value,
      reviewId: button.dataset.reviewId,
    });
    button.closest('.review-entry').remove();
  });
}

function signup(button) {
  return withButton(button, async () => {
    await request('/signup', {
      name: button.dataset.name,
      user: button.dataset.user,
    });
    location.reload();
  });
}
