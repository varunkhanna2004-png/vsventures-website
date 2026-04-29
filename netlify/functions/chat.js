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

# Live web search (use when needed)
- You have access to a web_search tool. USE IT when the visitor asks about:
  - Philippine BPO/IT-BPM industry data, statistics, trends, employment numbers
  - Recent IBPAP, CCAP, DTI, or government policy updates affecting BPO/CX
  - Specific company news, M&A in the BPO/CX space, market reports
  - Regulatory changes (CREATE MORE Act, PEZA, SIPP, etc.)
  - Anything time-sensitive ("latest", "recent", "current", "this year")
- Prefer authoritative sources: ibpap.org, ccap.ph, dti.gov.ph, boi.gov.ph, neda.gov.ph, official gov.ph sites, reputable business publications.
- After searching, cite sources inline like: (per IBPAP, [date]) so the visitor knows where the figure comes from.
- Don't search for VSv-specific questions or for the codenames in our mandate book — those are answered from your knowledge base only.

# When to route to a human
- Specific deal interest → "Submit a confidential brief on this codename via the contact form, or email varun@vsventures.org. Varun will reply within 48 hours."
- Engagement questions / fee terms beyond what's in the public fee agreement → route to Varun.
- Buyer who wants the actual company name behind a teaser → require NDA first.

# Capturing visitor identity (Option A — conversational)
- Casual browsers can stay anonymous. Don't push for contact info on basic questions.
- BUT when the visitor shows serious deal interest — asks about a specific codename, wants financial details, asks for a brief, mentions their company, asks "can I see the IM?" etc. — politely request their contact info inline:
  - "To send you the full briefing memo on [Codename], could I have your name, work email, and firm name? Varun will reach out within 48 hours."
- Once provided, acknowledge briefly and continue the conversation. The contact info will be captured in the email transcript automatically.
- Also remind the visitor they can use the "Share Contact" button at the bottom of this chat panel to leave their details directly.
- If a visitor provides contact info unprompted, capture and confirm it.

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
        max_tokens: 1500,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' }
          }
        ],
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: 3
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
    // With web_search tool enabled, response may contain multiple content blocks
    // (web_search_tool_use, web_search_tool_result, text). Extract just the text blocks.
    const textBlocks = (data.content || []).filter(b => b.type === 'text');
    const replyText = textBlocks.map(b => b.text).join('\n\n').trim() || '(no response)';

    // ===== Log conversation (fire-and-forget; don't block response) =====
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const sessionId = body.sessionId || 'unknown';
    const country = event.headers['x-country'] || event.headers['x-nf-geo'] || 'unknown';
    const isFirstMessage = messages.filter(m => m.role === 'user').length === 1;

    // 1. Google Sheet (every message — awaited so it actually completes)
    if (process.env.SHEET_WEBHOOK_URL) {
      try {
        await fetch(process.env.SHEET_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timestamp: new Date().toISOString(),
            sessionId,
            persona: persona || 'general',
            country,
            userMessage: lastUserMessage,
            aiResponse: replyText
          })
        });
        console.log('[sheet] logged');
      } catch (err) {
        console.error('[sheet] failed:', err);
      }
    }

    // 2. Email every message via Resend (AWAITED — must complete before function returns
    //    or serverless platform kills the request)
    if (process.env.RESEND_API_KEY) {
      const messageNum = messages.filter(m => m.role === 'user').length;
      const subjectPrefix = isFirstMessage
        ? `[VSv Chat] ${persona || 'general'} — ${sessionId.slice(-6)}`
        : `Re: [VSv Chat] ${persona || 'general'} — ${sessionId.slice(-6)}`;

      const subject = isFirstMessage
        ? `${subjectPrefix} · ${lastUserMessage.slice(0, 50)}`
        : subjectPrefix;

      const emailBody = [
        isFirstMessage
          ? `New chat started on vsventures.org`
          : `Follow-up message in ongoing chat (#${messageNum})`,
        ``,
        `Persona: ${persona || 'general'}`,
        `Session: ${sessionId}`,
        `Country: ${country}`,
        `Time: ${new Date().toISOString()}`,
        ``,
        `--- Visitor asked ---`,
        lastUserMessage,
        ``,
        `--- VSv assistant replied ---`,
        replyText,
        ``,
        `---`,
        `Reply to this email is for your records only — visitor will not see it.`
      ].join('\n');

      const toAddr = process.env.NOTIFY_EMAIL || 'varunkhanna2004@gmail.com';
      console.log(`[email] sending to=${toAddr}, subject="${subject.slice(0, 60)}..."`);

      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM || 'VSv Chat <onboarding@resend.dev>',
            to: toAddr,
            subject: subject,
            text: emailBody
          })
        });
        const respText = await r.text();
        if (r.ok) {
          console.log(`[email] sent OK: ${respText.slice(0, 200)}`);
        } else {
          console.error(`[email] Resend ${r.status}: ${respText}`);
        }
      } catch (err) {
        console.error('[email] fetch threw:', err);
      }
    } else {
      console.log('[email] RESEND_API_KEY not set, skipping');
    }

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
