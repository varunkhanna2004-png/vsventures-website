// Handle explicit "Leave contact" form submissions from the chat panel
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Email service not configured' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { name, email, firm, note, sessionId, persona } = body;

  if (!name || !email) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Name and email are required' })
    };
  }

  // Light email format validation
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid email format' })
    };
  }

  const country = event.headers['x-country'] || event.headers['x-nf-geo'] || 'unknown';

  const emailBody = [
    `🟡 New qualified lead from vsventures.org chat`,
    ``,
    `Name: ${name}`,
    `Email: ${email}`,
    `Firm: ${firm || '(not provided)'}`,
    `Persona: ${persona || 'general'}`,
    `Country: ${country}`,
    `Session: ${sessionId || 'unknown'}`,
    `Time: ${new Date().toISOString()}`,
    ``,
    `--- Note from visitor ---`,
    note || '(no note)',
    ``,
    `---`,
    `This visitor explicitly shared contact details via the "Share Contact" button in the chat panel. They are likely a serious lead. Reply directly to ${email}.`
  ].join('\n');

  const toAddr = process.env.NOTIFY_EMAIL || 'varunkhanna2004@gmail.com';
  console.log(`[lead] sending to=${toAddr}, name=${name}, email=${email}`);

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'VSv Lead <onboarding@resend.dev>',
        to: toAddr,
        reply_to: email,
        subject: `[VSv Lead] ${name} · ${persona || 'general'} · ${firm || ''}`.trim(),
        text: emailBody
      })
    });
    const respText = await r.text();
    if (!r.ok) {
      console.error(`[lead] Resend ${r.status}: ${respText}`);
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Could not send notification', detail: respText })
      };
    }
    console.log(`[lead] sent OK`);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true })
    };
  } catch (err) {
    console.error('[lead] fetch threw:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Lead capture failure', detail: String(err) })
    };
  }
};
