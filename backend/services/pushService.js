const webpush = require('web-push');
const pushSubscriptionRepository = require('../repositories/pushSubscriptionRepository');

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_CONTACT_EMAIL || 'admin@example.com'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

async function saveSubscription({ userId, subscription }) {
  const { endpoint, keys } = subscription;
  return pushSubscriptionRepository.upsert({ userId, endpoint, keys });
}

async function sendMatchNotification({ userId, matchedWithName }) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;

  const subscriptions = await pushSubscriptionRepository.findAllForUser(userId);
  if (subscriptions.length === 0) return;

  const payload = JSON.stringify({
    title: "It's a Match!",
    body: `You and ${matchedWithName} liked each other!`,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: 'match',
    data: { type: 'match' },
  });

  await Promise.allSettled(
    subscriptions.map(async sub => {
      try {
        await webpush.sendNotification(sub, payload);
      } catch (err) {
        if (err.statusCode === 410) {
          // Subscription expired — remove it
          await pushSubscriptionRepository.remove({ userId, endpoint: sub.endpoint });
        } else {
          console.error('push send error', err.message);
        }
      }
    })
  );
}

module.exports = { getVapidPublicKey, saveSubscription, sendMatchNotification };
