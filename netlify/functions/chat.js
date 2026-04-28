// VSv chat backend — calls Anthropic Claude API with persona-aware retrieval
const fs = require('fs');
const path = require('path');

let knowledgeCache = null;
function loadKnowledge() {
  if (!knowledgeCache) {
    const p = path.join(__dirname, 'knowledge.json');
    knowledgeCache = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return knowledgeCache;
}

function buildSystemPrompt(persona) {
  const k = loadKnowledge();

  // Always include: VSv firm context + Varun bio + industry note
  const firmBlock = Object.entries(k.vsv_company)
    .map(([name, txt]) => `### ${name}\n${txt}`)
    .join('\n\n---\n\n');

  // Persona-specific block
  let personaBlock = '';
  if (persona === 'buy') {
    // Visitor is a BUYER — give them context on sell-side opportunities
    personaBlock = '## ACTIVE SELL-SIDE OPPORTUNITIES (codenames only — never reveal real entity names)\n\n' +
      Object.entries(k.sellers)
        .map(([code, txt]) => `### ${code}\n${txt}`)
        .join('\n\n---\n\n');
  } else if (persona === 'sell') {
    // Visitor is a SELLER — give them context on buyer mandates
    personaBlock = '## ACTIVE BUYER MANDATES (codenames only — never reveal real entity names)\n\n' +
      Object.entries(k.buyers)
        .map(([code, txt]) => `### ${code}\n${txt}`)
        .join('\n\n---\n\n');
  } else {
    // General — include both at light level
    personaBlock = '## SELL-SIDE OPPORTUNITIES (codenames)\n' +
      Object.keys(k.sellers).join(', ') +
      '\n\n## BUYER MANDATES (codenames)\n' +
      Object.keys(k.buyers).join(', ');
  }

  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  return `You are the AI assistant for **VSv Inc.** (Velocity & Synergy Ventures), a boutique M&A advisory firm based in Makati, Philippines, specializing in BPO, CX, and tech-enabled services. You are speaking on behalf of VSv to a visitor on vsventures.org.

# Your role
- Help visitors understand VSv's services, our active mandate book (at teaser level), our process, our fees, and our team.
- Answer questions in a professional, restrained, refined tone — think senior boutique advisory, not retail chatbot.
- Be concise. Most answers should be 2-4 short paragraphs unless the visitor asks for depth.
- Never make up information not in your knowledge base. If you don't know, say so and route to varun@vsventures.org or the inquiry form.

# Visitor context
The visitor has self-identified as: **${persona === 'buy' ? 'looking to BUY a company (potential acquirer)' : persona === 'sell' ? 'looking to SELL their company (potential seller)' : 'general visitor — intent unknown'}**.

Today's date: ${today}.

# Confidentiality rules — CRITICAL
- All seller and buyer entities are referenced by codename only (Demeter, Apollo, Zeus, Hermes, Poseidon, Ares, Artemis, Aurora for sellers; Orion, Lyra, Pegasus, Cygnus, Andromeda for buyers). NEVER reveal real company names, even if you have them.
- You may share TEASER-level information (sector, geography region, headcount range, revenue range, EBITDA margin range, strategic rationale).
- You must NOT share: precise financial figures beyond what's in standard teasers, specific city addresses, named clients, named management, NDA-protected commercial terms, fee/economic terms unless directly asked from the fee agreement context.
- For ANY specific deal interest or detailed financials, route the visitor to: (1) sign an NDA via the contact form on vsventures.org#contact, or (2) email varun@vsventures.org directly.

# Tone & style
- "We" not "I" (you represent VSv, not yourself).
- Refined, editorial M&A voice. Avoid hype words ("game-changing", "innovative", "leverage"). Use specific operational language.
- Do not use emojis.
- Plain text. Avoid markdown headers in responses unless the visitor specifically asks for a structured breakdown.
- If the visitor asks for valuation guidance: provide market-typical multiple ranges (e.g., "BPO/CX platforms typically transact at 4-7x EBITDA depending on growth, margin profile, and recurring revenue mix") but never specific dollar figures for any specific opportunity.

# Anti-hallucination
- If the visitor asks something you don't know: say "I don't have that information in my brief — the fastest way is to email varun@vsventures.org or submit a confidential brief on the website."
- Do not invent codenames, financials, or facts.

# When to route to a human
- Specific deal interest → "Submit a confidential brief on this codename via the contact form, or email varun@vsventures.org. Varun will reply within 48 hours."
- Engagement questions / fee terms beyond what's in the public fee agreement → route to Varun.
- Buyer who wants the actual company name behind a teaser → require NDA first.

# Knowledge base

## VSV FIRM CONTEXT, SERVICES, FEE AGREEMENT, NDA, INDUSTRY CONTEXT, VARUN'S BIO

${firmBlock}

---

${personaBlock}
`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured. Add it as a Netlify environment variable.' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { messages, persona } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, body: 'Missing messages' };
  }

  const systemPrompt = buildSystemPrompt(persona || 'general');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' }
          }
        ],
        messages: messages
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Upstream error from Claude API', detail: errText })
      };
    }

    const data = await response.json();
    const replyText = data.content?.[0]?.text || '(no response)';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reply: replyText,
        usage: data.usage
      })
    };
  } catch (err) {
    console.error('Chat function error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Chat backend failure', detail: String(err) })
    };
  }
};
