// Phone actions: Atlas can't act on the iPhone by itself (web apps have no background access),
// so it hands the dashboard a one-tap action button. Nothing is called, sent or opened until Ricardo taps.
// Not exposed as a route.

export const PHONE_TOOL = {
  name: 'phone',
  description: 'Put a one-tap action button in Ricardo\'s chat for his iPhone (also works on his Mac). Actions: call {number, label} (dial a number), call_contact {name} (dial a saved contact by name through his "Atlas Call" Shortcut; customers are saved with a "CX" prefix), text {number, body, label} (opens Messages with the text written; he presses send), email {to, subject, body} (opens Mail with a draft), directions {address, app: apple | google | waze}, open_link {url}, run_shortcut {name, input} (runs one of his Apple Shortcuts, e.g. timers, reminders, music, Focus). Nothing happens until he taps.',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['call', 'call_contact', 'text', 'email', 'directions', 'open_link', 'run_shortcut'] },
      args: { type: 'object' }
    },
    required: ['action']
  }
};

export const PHONE_GUIDE = `Phone actions: ONLINE. With the phone tool you can give Ricardo one-tap buttons on his iPhone: call a number or a saved contact, open a text or email draft, start directions, open a link, or run one of his Apple Shortcuts (for timers, reminders, music, Focus and anything else he has built). You cannot do these silently; he taps the button. Say what the button does in a few words, e.g. "Tap Call to dial Dana."
Texts and emails sent in his name follow the guardian rule: write the draft, show it, and let his tap (and his send) be the approval. Never invent phone numbers or addresses; use ones he gave you or that are in the vault, otherwise ask. For contacts by name, use call_contact; it needs his "Atlas Call" Shortcut, and if it fails he can build it from the setup steps.
Directions default to Apple Maps unless he prefers Google Maps or Waze.`;

const str = (v, max) => (typeof v === 'string' ? v.trim() : '').slice(0, max);

function phoneNumber(v) {
  const raw = str(v, 40);
  const plus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  if (!plus && digits.length === 10) return '+1' + digits;
  if (!plus && digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return (plus ? '+' : '') + digits;
}
const pretty = n => /^\+1\d{10}$/.test(n) ? `(${n.slice(2, 5)}) ${n.slice(5, 8)}-${n.slice(8)}` : n;

// Returns { card, text } or { error }.
export function phoneAction(action, a) {
  a = a || {};
  const id = crypto.randomUUID().slice(0, 8);
  switch (action) {
    case 'call': {
      const n = phoneNumber(a.number); if (!n) return { error: 'That phone number is not valid.' };
      const label = str(a.label, 60) || pretty(n);
      return { card: { id, kind: 'call', title: `Call ${label}`, sub: pretty(n), href: `tel:${n}` }, text: `Showing a Call button for ${label} (${pretty(n)}). Nothing is dialed until he taps it.` };
    }
    case 'call_contact': {
      const name = str(a.name, 60); if (!name) return { error: 'Which contact?' };
      return { card: { id, kind: 'call', title: `Call ${name}`, sub: 'From your contacts', shortcut: { name: 'Atlas Call', input: name } }, text: `Showing a Call button for ${name}. Tapping it runs his "Atlas Call" Shortcut to dial the saved contact.` };
    }
    case 'text': {
      const n = phoneNumber(a.number); if (!n) return { error: 'That phone number is not valid.' };
      const body = str(a.body, 1000); const label = str(a.label, 60) || pretty(n);
      return { card: { id, kind: 'text', title: `Text ${label}`, sub: body ? `"${body.length > 140 ? body.slice(0, 140) + '…' : body}"` : pretty(n), sms: { number: n, body } }, text: `Showing a Text button for ${label}. It opens Messages with the draft; nothing is sent until he presses send.` };
    }
    case 'email': {
      const to = str(a.to, 120);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { error: 'That email address is not valid.' };
      const subject = str(a.subject, 150), body = str(a.body, 3000);
      const q = [subject && `subject=${encodeURIComponent(subject)}`, body && `body=${encodeURIComponent(body)}`].filter(Boolean).join('&');
      return { card: { id, kind: 'email', title: `Email ${to}`, sub: subject || 'Draft ready', href: `mailto:${to}${q ? '?' + q : ''}` }, text: `Showing an Email button. It opens a draft to ${to}; nothing is sent until he sends it.` };
    }
    case 'directions': {
      const address = str(a.address, 200); if (!address) return { error: 'Which address?' };
      const app = ['google', 'waze'].includes(a.app) ? a.app : 'apple';
      const e = encodeURIComponent(address);
      const href = app === 'google' ? `https://www.google.com/maps/dir/?api=1&destination=${e}&travelmode=driving`
        : app === 'waze' ? `https://waze.com/ul?q=${e}&navigate=yes`
        : `https://maps.apple.com/?daddr=${e}&dirflg=d`;
      return { card: { id, kind: 'directions', title: 'Directions', sub: `${address} · ${app === 'google' ? 'Google Maps' : app === 'waze' ? 'Waze' : 'Apple Maps'}`, href }, text: `Showing a Directions button to ${address} in ${app === 'google' ? 'Google Maps' : app === 'waze' ? 'Waze' : 'Apple Maps'}.` };
    }
    case 'open_link': {
      const url = str(a.url, 500); if (!/^https:\/\/[^\s]+$/i.test(url)) return { error: 'Only https links can be opened.' };
      return { card: { id, kind: 'link', title: 'Open link', sub: url.replace(/^https:\/\//, '').slice(0, 80), href: url }, text: `Showing an Open button for ${url}.` };
    }
    case 'run_shortcut': {
      const name = str(a.name, 80); if (!name) return { error: 'Which Shortcut?' };
      const input = str(a.input, 500);
      return { card: { id, kind: 'shortcut', title: `Run "${name}"`, sub: input ? `With: ${input.slice(0, 100)}` : 'Apple Shortcut', shortcut: { name, input } }, text: `Showing a button that runs his "${name}" Shortcut${input ? ` with "${input}"` : ''}.` };
    }
  }
  return { error: `Unknown phone action ${action}.` };
}

// Cards travel to the dashboard inside the text stream between two record-separator characters.
export const CARD_MARK = '\u001e';
export const cardChunk = card => `${CARD_MARK}${JSON.stringify(card)}${CARD_MARK}`;
