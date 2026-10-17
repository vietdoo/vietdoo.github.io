import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const OUT_DIR_AGENT = path.resolve('public/blog/agent-identity-delegation-revocation');
const OUT_DIR_CONTEXT = path.resolve('public/blog/context-engineering');

fs.mkdirSync(OUT_DIR_AGENT, { recursive: true });
fs.mkdirSync(OUT_DIR_CONTEXT, { recursive: true });

const roughCode = fs.readFileSync('scripts/rough.min.js', 'utf8');

function getBaseHtml(bodyContent) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Architects+Daughter&family=Kalam:wght@700&family=Patrick+Hand:wght@400;700&family=Permanent+Marker&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1600px;
      height: 900px;
      overflow: hidden;
      background: #16181b;
      position: relative;
      user-select: none;
    }
    .chalkboard-bg {
      position: absolute;
      inset: 0;
      background: 
        radial-gradient(circle at 50% 35%, #24282d 0%, #131517 100%);
    }
    .chalk-grid {
      position: absolute;
      inset: 0;
      background-size: 36px 36px;
      background-image: 
        linear-gradient(to right, rgba(255, 255, 255, 0.035) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
    }
    svg.canvas {
      position: absolute;
      inset: 0;
      width: 1600px;
      height: 900px;
    }
    .font-marker { font-family: 'Permanent Marker', cursive; }
    .font-hand { font-family: 'Patrick Hand', cursive; }
    .font-kalam { font-family: 'Kalam', cursive; }
    .font-arch { font-family: 'Architects Daughter', cursive; }
  </style>
</head>
<body>
  <div class="chalkboard-bg"></div>
  <div class="chalk-grid"></div>
  <svg id="svg" class="canvas" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">
    <defs>
      <filter id="chalk-rough" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" result="noise"/>
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2"/>
      </filter>
    </defs>
    <g id="rough-container" filter="url(#chalk-rough)"></g>
  </svg>

  <script>${roughCode}</script>
  <script>
  (() => {
    const svg = document.getElementById('svg');
    const container = document.getElementById('rough-container');
    const rc = rough.svg(svg);

    const C = {
      white: '#fdfbf7',
      teal: '#2dd4bf',
      amber: '#f59e0b',
      coral: '#f87171',
      blue: '#38bdf8',
      purple: '#c084fc',
      green: '#4ade80',
      darkSlate: '#1a2234',
      cardBg: 'rgba(23, 32, 48, 0.85)'
    };

    function addText(x, y, str, fontClass, size, color, align = 'left', rotate = 0) {
      const lines = str.split('\\n');
      const lineHeight = size * 1.25;
      const startY = y - ((lines.length - 1) * lineHeight) / 2;
      lines.forEach((line, idx) => {
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', x);
        t.setAttribute('y', startY + idx * lineHeight);
        t.setAttribute('class', fontClass);
        t.setAttribute('font-size', size + 'px');
        t.setAttribute('fill', color);
        t.setAttribute('text-anchor', align);
        if (rotate) {
          t.setAttribute('transform', 'rotate(' + rotate + ' ' + x + ' ' + y + ')');
        }
        t.textContent = line;
        container.appendChild(t);
      });
    }

    function speechBubble(x, y, w, h, tailX, tailY, text, options = {}) {
      const bubble = rc.rectangle(x, y, w, h, {
        roughness: 2.2,
        stroke: options.stroke || C.white,
        strokeWidth: options.strokeWidth || 3.5,
        fill: options.fill || C.cardBg,
        fillStyle: 'solid'
      });
      container.appendChild(bubble);
      
      const tail = rc.polygon([[x + w/2 - 18, y + h - 2], [tailX, tailY], [x + w/2 + 18, y + h - 2]], {
        roughness: 2,
        stroke: options.stroke || C.white,
        strokeWidth: options.strokeWidth || 3.5,
        fill: options.fill || C.cardBg,
        fillStyle: 'solid'
      });
      container.appendChild(tail);

      addText(x + w/2, y + h/2 + 2, text, options.font || 'font-hand', options.fontSize || 22, options.textColor || C.white, 'middle');
    }

    function drawStamp(x, y, w, h, text, color, angle = -5) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', 'rotate(' + angle + ' ' + (x + w/2) + ' ' + (y + h/2) + ')');
      
      const r1 = rc.rectangle(x, y, w, h, {
        stroke: color, strokeWidth: 4, roughness: 2.5
      });
      const r2 = rc.rectangle(x + 5, y + 5, w - 10, h - 10, {
        stroke: color, strokeWidth: 2, roughness: 1.8
      });
      g.appendChild(r1);
      g.appendChild(r2);
      container.appendChild(g);

      addText(x + w/2, y + h/2 + 4, text, 'font-marker', h * 0.45, color, 'middle', angle);
    }

    function drawRobot(x, y, scale = 1, options = {}) {
      // Antenna
      container.appendChild(rc.line(x, y - 75*scale, x, y - 45*scale, { stroke: C.white, strokeWidth: 3.5, roughness: 1.5 }));
      container.appendChild(rc.circle(x, y - 82*scale, 18*scale, {
        stroke: options.antennaColor || C.amber,
        strokeWidth: 3.5,
        fill: options.antennaColor || C.amber,
        fillStyle: 'solid',
        roughness: 1.5
      }));

      // Head
      container.appendChild(rc.rectangle(x - 55*scale, y - 45*scale, 110*scale, 75*scale, {
        stroke: C.white,
        strokeWidth: 4.5,
        roughness: 2.2,
        fill: options.headFill || 'rgba(45, 212, 191, 0.2)',
        fillStyle: 'hachure',
        hachureAngle: 60,
        hachureGap: 7
      }));

      // Ears (bolts)
      container.appendChild(rc.rectangle(x - 68*scale, y - 25*scale, 13*scale, 22*scale, { stroke: C.white, strokeWidth: 3, roughness: 1.5 }));
      container.appendChild(rc.rectangle(x + 55*scale, y - 25*scale, 13*scale, 22*scale, { stroke: C.white, strokeWidth: 3, roughness: 1.5 }));

      // Eyes
      const eyeColor = options.eyeColor || C.teal;
      container.appendChild(rc.circle(x - 26*scale, y - 14*scale, 22*scale, { stroke: C.white, strokeWidth: 3.5, fill: eyeColor, fillStyle: 'solid', roughness: 1.2 }));
      container.appendChild(rc.circle(x + 26*scale, y - 14*scale, 22*scale, { stroke: C.white, strokeWidth: 3.5, fill: eyeColor, fillStyle: 'solid', roughness: 1.2 }));
      // Pupils
      const pupilXOff = options.panicked ? 0 : 4;
      container.appendChild(rc.circle(x - (26-pupilXOff)*scale, y - 14*scale, 8*scale, { stroke: '#0f172a', strokeWidth: 2, fill: '#0f172a', fillStyle: 'solid' }));
      container.appendChild(rc.circle(x + (26+pupilXOff)*scale, y - 14*scale, 8*scale, { stroke: '#0f172a', strokeWidth: 2, fill: '#0f172a', fillStyle: 'solid' }));

      // Mouth
      if (options.panicked) {
        container.appendChild(rc.rectangle(x - 25*scale, y + 10*scale, 50*scale, 16*scale, { stroke: C.coral, strokeWidth: 3, fill: C.coral, fillStyle: 'solid' }));
      } else {
        container.appendChild(rc.curve([[x - 30*scale, y + 12*scale], [x, y + 24*scale], [x + 30*scale, y + 12*scale]], {
          stroke: C.white, strokeWidth: 4, roughness: 1.5
        }));
      }

      // Neck coil
      container.appendChild(rc.line(x - 22*scale, y + 36*scale, x + 22*scale, y + 36*scale, { stroke: C.white, strokeWidth: 4 }));
      container.appendChild(rc.line(x - 16*scale, y + 43*scale, x + 16*scale, y + 43*scale, { stroke: C.white, strokeWidth: 4 }));

      // Body
      container.appendChild(rc.rectangle(x - 68*scale, y + 48*scale, 136*scale, 115*scale, {
        stroke: C.white,
        strokeWidth: 4.5,
        roughness: 2.2,
        fill: options.bodyFill || 'rgba(56, 189, 248, 0.12)',
        fillStyle: 'cross-hatch',
        hachureGap: 10
      }));

      // Chest screen/badge
      container.appendChild(rc.rectangle(x - 48*scale, y + 62*scale, 96*scale, 48*scale, {
        stroke: options.badgeStroke || C.amber,
        strokeWidth: 3,
        roughness: 1.5,
        fill: 'rgba(245, 158, 11, 0.18)',
        fillStyle: 'solid'
      }));
      addText(x, y + 90*scale, options.badgeText || 'AGENT', 'font-marker', 15*scale, options.badgeStroke || C.amber, 'middle');

      // Arms
      container.appendChild(rc.curve([[x - 68*scale, y + 68*scale], [x - 110*scale, y + 95*scale], [x - 125*scale, y + 60*scale]], {
        stroke: C.white, strokeWidth: 4.5, roughness: 1.8
      }));
      container.appendChild(rc.circle(x - 130*scale, y + 55*scale, 18*scale, { stroke: C.white, strokeWidth: 3.5 }));

      container.appendChild(rc.curve([[x + 68*scale, y + 68*scale], [x + 115*scale, y + 85*scale], [x + 135*scale, y + 125*scale]], {
        stroke: C.white, strokeWidth: 4.5, roughness: 1.8
      }));
      container.appendChild(rc.circle(x + 140*scale, y + 130*scale, 18*scale, { stroke: C.white, strokeWidth: 3.5 }));

      // Feet / base
      container.appendChild(rc.rectangle(x - 50*scale, y + 163*scale, 35*scale, 25*scale, { stroke: C.white, strokeWidth: 3.5, roughness: 1.8 }));
      container.appendChild(rc.rectangle(x + 15*scale, y + 163*scale, 35*scale, 25*scale, { stroke: C.white, strokeWidth: 3.5, roughness: 1.8 }));
    }

    function drawHuman(x, y, scale = 1, options = {}) {
      // Head
      container.appendChild(rc.circle(x, y, 65*scale, { stroke: C.white, strokeWidth: 4, roughness: 2 }));
      // Messy curly hair
      container.appendChild(rc.path('M ' + (x-35*scale) + ' ' + (y-10*scale) + ' Q ' + x + ' ' + (y-55*scale) + ' ' + (x+35*scale) + ' ' + (y-10*scale) + ' Q ' + (x+15*scale) + ' ' + (y-35*scale) + ' ' + (x-15*scale) + ' ' + (y-30*scale) + ' Z', {
        stroke: C.white, strokeWidth: 3.5, fill: C.white, fillStyle: 'hachure', hachureGap: 4
      }));
      // Glasses / Eyes
      container.appendChild(rc.circle(x - 16*scale, y, 16*scale, { stroke: C.white, strokeWidth: 3, roughness: 1.2 }));
      container.appendChild(rc.circle(x + 16*scale, y, 16*scale, { stroke: C.white, strokeWidth: 3, roughness: 1.2 }));
      container.appendChild(rc.line(x - 5*scale, y, x + 5*scale, y, { stroke: C.white, strokeWidth: 3 }));
      // Smile / mouth
      container.appendChild(rc.curve([[x - 18*scale, y + 20*scale], [x, y + 28*scale], [x + 18*scale, y + 20*scale]], { stroke: C.white, strokeWidth: 3 }));
      // Body
      container.appendChild(rc.line(x, y + 35*scale, x, y + 180*scale, { stroke: C.white, strokeWidth: 5, roughness: 1.8 }));
      // Legs
      container.appendChild(rc.line(x, y + 180*scale, x - 45*scale, y + 310*scale, { stroke: C.white, strokeWidth: 5, roughness: 1.8 }));
      container.appendChild(rc.line(x, y + 180*scale, x + 45*scale, y + 310*scale, { stroke: C.white, strokeWidth: 5, roughness: 1.8 }));
    }

    ${bodyContent}
  })();
  </script>
</body>
</html>`;
}

// 8 REFINED DIAGRAM DEFINITIONS
const DIAGRAMS = [
  // 1. Agent Identity Hero
  {
    path: path.join(OUT_DIR_AGENT, 'hero.webp'),
    name: 'agent-identity-hero',
    code: `
      addText(800, 75, 'AI AGENT IDENTITY: DELEGATION & SCOPED KEYS', 'font-marker', 46, C.white, 'middle');
      addText(800, 118, 'Never hand your robot assistant the master database keys!', 'font-kalam', 26, C.amber, 'middle');

      // 1. Human Engineer on left
      drawHuman(240, 420, 1.1);
      container.appendChild(rc.curve([[240, 480], [330, 490], [420, 470]], { stroke: C.white, strokeWidth: 5, roughness: 1.8 }));
      
      // Scoped Pass Card
      container.appendChild(rc.rectangle(420, 435, 150, 85, {
        stroke: C.amber, strokeWidth: 4, roughness: 2, fill: 'rgba(245, 158, 11, 0.25)', fillStyle: 'solid'
      }));
      addText(495, 465, 'SCOPED PASS', 'font-marker', 18, C.amber, 'middle');
      addText(495, 492, 'TTL: 15 MINS', 'font-hand', 18, C.white, 'middle');
      addText(495, 510, 'ACTOR: BOT-42', 'font-hand', 15, C.teal, 'middle');

      speechBubble(120, 210, 270, 115, 240, 370, 'Hey Bot! Do THIS task only!\\nRead tickets — NO ROOT!\\nNO DROP DATABASE!', {
        fontSize: 22, stroke: C.teal, textColor: C.teal
      });

      // 2. Center Robot Agent
      drawRobot(760, 490, 1.3, {
        badgeText: 'ACTOR: BOT',
        badgeStroke: C.amber,
        headFill: 'rgba(45, 212, 191, 0.2)'
      });

      speechBubble(640, 205, 310, 115, 760, 390, 'YAY! I have a scoped token!\\nSubject: Alice\\nActor: RobotAssistant\\nI will behave nicely!', {
        fontSize: 21, stroke: C.amber, textColor: C.white
      });

      // Arrow pointing to vault
      container.appendChild(rc.line(950, 530, 1100, 530, { stroke: C.teal, strokeWidth: 5, roughness: 1.5 }));
      container.appendChild(rc.polygon([[1100, 515], [1135, 530], [1100, 545]], { stroke: C.teal, strokeWidth: 3, fill: C.teal, fillStyle: 'solid' }));
      addText(1030, 510, 'TOKEN EXCHANGE', 'font-marker', 16, C.teal, 'middle');

      // 3. Vault & Guard on Right
      container.appendChild(rc.rectangle(1160, 320, 340, 440, {
        stroke: C.white, strokeWidth: 5, roughness: 2.2, fill: 'rgba(30, 41, 59, 0.8)', fillStyle: 'cross-hatch', hachureGap: 16
      }));
      addText(1330, 375, 'PROTECTED VAULT', 'font-marker', 28, C.white, 'middle');
      addText(1330, 412, 'Strict Authorization Gate', 'font-kalam', 20, C.amber, 'middle');

      // Safe combination lock
      container.appendChild(rc.circle(1330, 520, 120, { stroke: C.amber, strokeWidth: 4.5, fill: 'rgba(245, 158, 11, 0.1)', fillStyle: 'solid', roughness: 1.8 }));
      container.appendChild(rc.circle(1330, 520, 55, { stroke: C.white, strokeWidth: 3.5, roughness: 1.5 }));
      container.appendChild(rc.line(1330, 520, 1360, 490, { stroke: C.coral, strokeWidth: 4.5 }));

      // Stamp on vault
      drawStamp(1200, 640, 260, 65, 'AUTHORIZED SCOPE', C.teal, -4);
    `
  },

  // 2. Intersection Authority (Refined positioning)
  {
    path: path.join(OUT_DIR_AGENT, 'intersection-authority.webp'),
    name: 'agent-identity-intersection',
    code: `
      addText(800, 70, 'EFFECTIVE AUTHORITY: THE STRICT INTERSECTION', 'font-marker', 44, C.white, 'middle');
      addText(800, 112, 'Effective Authority = User Rights ∩ Agent Role ∩ Task Scope ∩ Environment', 'font-kalam', 24, C.amber, 'middle');

      // 4 Overlapping Venn Circles centered at cx = 620
      const cx = 620, cy = 490, r = 250;
      // 1. User Privileges (Top-Left)
      container.appendChild(rc.circle(cx - 95, cy - 80, r, {
        stroke: C.teal, strokeWidth: 4.5, roughness: 2.2, fill: 'rgba(45, 212, 191, 0.1)', fillStyle: 'hachure', hachureAngle: 45, hachureGap: 18
      }));
      addText(cx - 240, cy - 180, '1. USER RIGHTS', 'font-marker', 22, C.teal, 'middle');
      addText(cx - 240, cy - 148, 'User permissions & entitlements', 'font-hand', 18, C.white, 'middle');

      // 2. Agent Role Max (Top-Right)
      container.appendChild(rc.circle(cx + 95, cy - 80, r, {
        stroke: C.blue, strokeWidth: 4.5, roughness: 2.2, fill: 'rgba(56, 189, 248, 0.1)', fillStyle: 'hachure', hachureAngle: -45, hachureGap: 18
      }));
      addText(cx + 240, cy - 180, '2. AGENT ROLE', 'font-marker', 22, C.blue, 'middle');
      addText(cx + 240, cy - 148, 'Declared tool capability bound', 'font-hand', 18, C.white, 'middle');

      // 3. Task Scope (Bottom-Left)
      container.appendChild(rc.circle(cx - 95, cy + 80, r, {
        stroke: C.purple, strokeWidth: 4.5, roughness: 2.2, fill: 'rgba(192, 132, 252, 0.1)', fillStyle: 'hachure', hachureAngle: 135, hachureGap: 18
      }));
      addText(cx - 240, cy + 225, '3. TASK SCOPE', 'font-marker', 22, C.purple, 'middle');
      addText(cx - 240, cy + 258, 'Checklist for current run only', 'font-hand', 18, C.white, 'middle');

      // 4. Environment & Time (Bottom-Right)
      container.appendChild(rc.circle(cx + 95, cy + 80, r, {
        stroke: C.coral, strokeWidth: 4.5, roughness: 2.2, fill: 'rgba(248, 113, 113, 0.1)', fillStyle: 'hachure', hachureAngle: -135, hachureGap: 18
      }));
      addText(cx + 240, cy + 225, '4. CONTEXT & TIME', 'font-marker', 22, C.coral, 'middle');
      addText(cx + 240, cy + 258, 'Valid subnet IP & TTL <= 15m', 'font-hand', 18, C.white, 'middle');

      // Center Glowing Intersection
      container.appendChild(rc.circle(cx, cy, 95, {
        stroke: C.amber, strokeWidth: 5, fill: 'rgba(245, 158, 11, 0.45)', fillStyle: 'solid', roughness: 1.8
      }));
      addText(cx, cy - 14, 'STRICT', 'font-marker', 24, C.amber, 'middle');
      addText(cx, cy + 14, 'INTERSECTION', 'font-marker', 22, C.amber, 'middle');
      addText(cx, cy + 36, '(ALLOWED!)', 'font-hand', 18, C.white, 'middle');

      // Blocked stamps in outer zones
      drawStamp(cx - 210, cy - 20, 130, 42, 'BLOCKED', C.coral, -12);
      drawStamp(cx + 90, cy - 20, 130, 42, 'DENIED', C.coral, 15);
      drawStamp(cx - 60, cy + 250, 130, 42, 'NO-GO', C.coral, -5);

      // Sneaky Little Robot on the right
      drawRobot(1330, 540, 1.0, { panicked: true, eyeColor: C.coral, badgeText: 'DENIED!' });
      
      // Mallet bonking robot
      container.appendChild(rc.rectangle(1290, 390, 80, 40, { stroke: C.coral, strokeWidth: 4, fill: C.coral, fillStyle: 'solid', roughness: 2 }));
      container.appendChild(rc.line(1330, 430, 1330, 470, { stroke: C.white, strokeWidth: 5 }));
      addText(1330, 370, 'BONK! DENIED!', 'font-marker', 20, C.coral, 'middle');

      speechBubble(1180, 220, 280, 100, 1330, 370, '"Can I access root?\\nJust this once please?"', {
        fontSize: 22, stroke: C.coral, textColor: C.coral
      });
    `
  },

  // 3. Token Exchange Flow (Refined layout)
  {
    path: path.join(OUT_DIR_AGENT, 'token-exchange.webp'),
    name: 'agent-identity-token-exchange',
    code: `
      addText(800, 70, 'RFC 8693 TOKEN EXCHANGE: 4-STEP RELAY', 'font-marker', 44, C.white, 'middle');
      addText(800, 112, 'Delegating scoped authority step-by-step without credential leakage', 'font-kalam', 24, C.amber, 'middle');

      const panels = [
        { x: 80, y: 190, w: 320, h: 540, step: 'STEP 1', title: 'USER INTENT', color: C.teal },
        { x: 440, y: 190, w: 320, h: 540, step: 'STEP 2', title: 'TOKEN EXCHANGE', color: C.blue },
        { x: 800, y: 190, w: 320, h: 540, step: 'STEP 3', title: 'AUTH MINTING', color: C.amber },
        { x: 1160, y: 190, w: 340, h: 540, step: 'STEP 4', title: 'API VERIFICATION', color: C.green }
      ];

      panels.forEach((p, idx) => {
        container.appendChild(rc.rectangle(p.x, p.y, p.w, p.h, {
          stroke: p.color, strokeWidth: 4, roughness: 2.2, fill: C.cardBg, fillStyle: 'solid'
        }));
        
        container.appendChild(rc.rectangle(p.x + 20, p.y + 20, 100, 38, {
          stroke: p.color, strokeWidth: 2.5, fill: p.color, fillStyle: 'solid', roughness: 1.5
        }));
        addText(p.x + 70, p.y + 44, p.step, 'font-marker', 18, '#0f172a', 'middle');
        addText(p.x + p.w/2, p.y + 90, p.title, 'font-marker', 22, p.color, 'middle');

        if (idx < 3) {
          const ax1 = p.x + p.w;
          const ax2 = panels[idx + 1].x;
          const ay = p.y + p.h/2;
          container.appendChild(rc.line(ax1 + 5, ay, ax2 - 5, ay, { stroke: C.amber, strokeWidth: 4, roughness: 1.5 }));
          container.appendChild(rc.polygon([[ax2 - 18, ay - 10], [ax2 - 4, ay], [ax2 - 18, ay + 10]], {
            stroke: C.amber, strokeWidth: 2.5, fill: C.amber, fillStyle: 'solid'
          }));
        }
      });

      // Panel 1
      speechBubble(95, 335, 290, 85, 240, 480, '"Hey App, run ticket check!\\nSubject = Alice"', { fontSize: 20, stroke: C.teal, textColor: C.teal });
      drawHuman(240, 520, 0.8);
      addText(240, 685, 'Alice logs in via OAuth\\nPasses User Subject Token', 'font-hand', 18, C.white, 'middle');

      // Panel 2
      container.appendChild(rc.rectangle(480, 310, 240, 150, { stroke: C.blue, strokeWidth: 3, fill: 'rgba(56, 189, 248, 0.1)', fillStyle: 'solid', roughness: 1.5 }));
      addText(600, 345, 'RFC 8693 PAYLOAD', 'font-marker', 16, C.blue, 'middle');
      addText(600, 380, 'subject_token: [Alice]', 'font-hand', 18, C.white, 'middle');
      addText(600, 405, 'actor_token: [Bot-42]', 'font-hand', 18, C.amber, 'middle');
      addText(600, 430, 'scope: read_tickets', 'font-hand', 18, C.teal, 'middle');
      addText(600, 560, 'Client App requests\\nDelegated Actor Token', 'font-hand', 20, C.white, 'middle');
      addText(600, 675, 'Token Exchange Endpoint\\nValidates both client & user', 'font-hand', 17, C.white, 'middle');

      // Panel 3
      container.appendChild(rc.circle(960, 360, 65, { stroke: C.amber, strokeWidth: 4, fill: 'rgba(245, 158, 11, 0.2)', fillStyle: 'solid', roughness: 1.8 }));
      addText(960, 365, 'MINTING', 'font-marker', 16, C.amber, 'middle');
      container.appendChild(rc.line(960, 285, 960, 275, { stroke: C.amber, strokeWidth: 3 }));
      container.appendChild(rc.line(1040, 360, 1050, 360, { stroke: C.amber, strokeWidth: 3 }));
      addText(960, 480, 'DOWN-SCOPED JWT', 'font-marker', 18, C.amber, 'middle');
      addText(960, 520, 'Claims: { sub: Alice,', 'font-hand', 18, C.white, 'middle');
      addText(960, 545, '  act: { sub: Bot-42 },', 'font-hand', 18, C.amber, 'middle');
      addText(960, 570, '  exp: 15m, aud: api }', 'font-hand', 18, C.white, 'middle');
      addText(960, 675, 'Short-lived token\\nActor strictly bound', 'font-hand', 18, C.white, 'middle');

      // Panel 4
      container.appendChild(rc.rectangle(1200, 310, 260, 140, { stroke: C.green, strokeWidth: 3.5, fill: 'rgba(74, 222, 128, 0.1)', fillStyle: 'solid', roughness: 1.5 }));
      addText(1330, 345, 'API GATEWAY', 'font-marker', 18, C.green, 'middle');
      addText(1330, 380, '[x] Subject has access', 'font-hand', 18, C.white, 'middle');
      addText(1330, 405, '[x] Actor is registered', 'font-hand', 18, C.white, 'middle');
      addText(1330, 430, '[x] Scope strictly valid', 'font-hand', 18, C.white, 'middle');
      drawStamp(1230, 520, 200, 55, '200 OK', C.green, -3);
      addText(1330, 675, 'Resource returned safely\\nFull audit trail preserved!', 'font-hand', 18, C.white, 'middle');
    `
  },

  // 4. Revocation Timeline
  {
    path: path.join(OUT_DIR_AGENT, 'revocation-timeline.webp'),
    name: 'agent-identity-revocation',
    code: `
      addText(800, 70, 'EMERGENCY REVOCATION: PULLING THE PLUG', 'font-marker', 44, C.white, 'middle');
      addText(800, 112, '5-checkpoint sequence from anomaly detection to safe agent shutdown', 'font-kalam', 24, C.amber, 'middle');

      const startX = 140, endX = 1460, lineY = 480;
      container.appendChild(rc.line(startX, lineY, endX, lineY, { stroke: C.white, strokeWidth: 6, roughness: 1.8 }));

      const stages = [
        { x: 220, label: 'T = 0.0s', title: 'ANOMALY!', desc: 'Agent loops or\\nUser clicks Cancel', color: C.coral },
        { x: 500, label: 'T = 0.3s', title: 'KILL SWITCH', desc: 'Admin slams\\nRevocation Lever', color: C.amber },
        { x: 790, label: 'T = 0.6s', title: 'BLACKLIST', desc: 'Redis Token\\nMarked REVOKED', color: C.coral },
        { x: 1080, label: 'T = 1.0s', title: 'HARD STOP', desc: '401 Unauthorized!\\nTools blocked', color: C.blue },
        { x: 1370, label: 'T = 1.5s', title: 'CLEANUP', desc: 'State flushed\\nRollback complete', color: C.green }
      ];

      stages.forEach((st, idx) => {
        container.appendChild(rc.circle(st.x, lineY, 44, {
          stroke: st.color, strokeWidth: 4, fill: st.color, fillStyle: 'solid', roughness: 1.5
        }));
        addText(st.x, lineY + 6, '' + (idx + 1), 'font-marker', 22, '#0f172a', 'middle');

        const isAbove = idx % 2 === 0;
        const cardY = isAbove ? lineY - 240 : lineY + 50;
        
        container.appendChild(rc.line(st.x, lineY + (isAbove ? -22 : 22), st.x, isAbove ? cardY + 160 : cardY, {
          stroke: st.color, strokeWidth: 3, strokeDash: [4, 4]
        }));

        container.appendChild(rc.rectangle(st.x - 110, cardY, 220, 160, {
          stroke: st.color, strokeWidth: 3.5, roughness: 2, fill: C.cardBg, fillStyle: 'solid'
        }));
        addText(st.x, cardY + 30, st.label, 'font-marker', 15, st.color, 'middle');
        addText(st.x, cardY + 65, st.title, 'font-marker', 22, C.white, 'middle');
        addText(st.x, cardY + 110, st.desc, 'font-hand', 18, C.white, 'middle');
      });

      // Flashing Siren on Stage 1
      container.appendChild(rc.polygon([[200, lineY - 260], [240, lineY - 260], [230, lineY - 300], [210, lineY - 300]], {
        stroke: C.coral, strokeWidth: 3, fill: C.coral, fillStyle: 'solid'
      }));
      addText(220, lineY - 315, 'ALARM!', 'font-marker', 18, C.coral, 'middle');

      // Big Comic Lever on Stage 2
      container.appendChild(rc.rectangle(480, lineY + 230, 40, 80, { stroke: C.white, strokeWidth: 3, fill: '#334155', fillStyle: 'solid' }));
      container.appendChild(rc.line(500, lineY + 240, 540, lineY + 190, { stroke: C.coral, strokeWidth: 8 }));
      container.appendChild(rc.circle(545, lineY + 185, 20, { stroke: C.coral, strokeWidth: 3, fill: C.coral, fillStyle: 'solid' }));
      addText(500, lineY + 335, 'PULL LEVER!', 'font-marker', 16, C.coral, 'middle');

      // Robot dead-halted at Stage 4
      drawRobot(1080, lineY - 140, 0.75, { panicked: true, eyeColor: C.coral, badgeText: 'HALTED!' });
      speechBubble(960, lineY - 340, 240, 85, 1080, lineY - 210, 'WHOOPS! Token 401!\\nDropping all tools!', {
        fontSize: 18, stroke: C.coral, textColor: C.coral
      });
    `
  },

  // 5. Context Engineering Hero (Signal vs Chaos)
  {
    path: path.join(OUT_DIR_CONTEXT, 'hero.webp'),
    name: 'context-engineering-hero',
    code: `
      addText(800, 70, 'CONTEXT ENGINEERING: SIGNAL VS. CHAOS', 'font-marker', 44, C.white, 'middle');
      addText(800, 112, 'Drowning in endless token dumps vs. crisp, high-signal bounded execution', 'font-kalam', 24, C.amber, 'middle');

      container.appendChild(rc.line(800, 150, 800, 850, { stroke: C.white, strokeWidth: 4, strokeDash: [10, 10], roughness: 2 }));

      // === LEFT SIDE: NAIVE CHAOS ===
      container.appendChild(rc.rectangle(60, 160, 680, 680, {
        stroke: C.coral, strokeWidth: 4, roughness: 2.2, fill: 'rgba(248, 113, 113, 0.05)', fillStyle: 'solid'
      }));
      addText(400, 205, 'NAIVE DUMP (CHAOS!)', 'font-marker', 32, C.coral, 'middle');
      addText(400, 240, 'Stuffing everything into context window', 'font-kalam', 20, C.white, 'middle');

      speechBubble(180, 275, 260, 95, 340, 430, 'LOST IN THE MIDDLE!\\nWho was Alice?\\nTokens = 128k/128k!', {
        fontSize: 20, stroke: C.coral, textColor: C.coral
      });

      // Panicked Robot
      drawRobot(400, 520, 1.15, { panicked: true, eyeColor: C.coral, badgeText: 'FULL 128k!' });
      
      // Floating paper sheets
      const papers = [[140, 420], [140, 550], [600, 420], [600, 550]];
      papers.forEach(([px, py]) => {
        container.appendChild(rc.rectangle(px, py, 90, 65, {
          stroke: C.white, strokeWidth: 2.5, fill: 'rgba(255,255,255,0.08)', fillStyle: 'solid', roughness: 2
        }));
        container.appendChild(rc.line(px + 10, py + 20, px + 75, py + 20, { stroke: C.white, strokeWidth: 2 }));
        container.appendChild(rc.line(px + 10, py + 35, px + 65, py + 35, { stroke: C.white, strokeWidth: 2 }));
      });

      // Gauge meter FULL
      container.appendChild(rc.rectangle(250, 680, 300, 35, { stroke: C.coral, strokeWidth: 3, roughness: 1.5 }));
      container.appendChild(rc.rectangle(250, 680, 290, 35, { stroke: C.coral, strokeWidth: 2, fill: C.coral, fillStyle: 'solid' }));
      addText(400, 704, 'TOKEN USAGE: 100% (CRITICAL)', 'font-marker', 15, '#0f172a', 'middle');
      drawStamp(270, 750, 260, 55, 'SLOW & EXPENSIVE', C.coral, -4);

      // === RIGHT SIDE: ENGINEERED CONTEXT ===
      container.appendChild(rc.rectangle(860, 160, 680, 680, {
        stroke: C.teal, strokeWidth: 4, roughness: 2.2, fill: 'rgba(45, 212, 191, 0.05)', fillStyle: 'solid'
      }));
      addText(1200, 205, 'ENGINEERED CONTEXT', 'font-marker', 32, C.teal, 'middle');
      addText(1200, 240, 'Curated signal, compaction & durable memory', 'font-kalam', 20, C.white, 'middle');

      // Clean Clipboard card
      container.appendChild(rc.rectangle(940, 320, 210, 200, {
        stroke: C.teal, strokeWidth: 3.5, fill: C.cardBg, fillStyle: 'solid', roughness: 1.5
      }));
      addText(1045, 355, 'LEAN CONTEXT', 'font-marker', 17, C.teal, 'middle');
      addText(1045, 390, '[x] Goal: Update schema', 'font-hand', 16, C.white, 'middle');
      addText(1045, 415, '[x] Relevant schema only', 'font-hand', 16, C.white, 'middle');
      addText(1045, 440, '[x] Recent test result', 'font-hand', 16, C.white, 'middle');
      addText(1045, 465, '[>] Next tool: git commit', 'font-hand', 16, C.amber, 'middle');

      // Cool Robot with clipboard
      drawRobot(1240, 520, 1.15, { badgeText: '4k TOKENS', badgeStroke: C.teal, headFill: 'rgba(45, 212, 191, 0.25)' });

      speechBubble(1250, 290, 250, 95, 1250, 430, 'Fast & razor sharp!\\nZero hallucination!\\nTokens = 4k/128k!', {
        fontSize: 20, stroke: C.teal, textColor: C.teal
      });

      // Gauge meter LEAN
      container.appendChild(rc.rectangle(1050, 680, 300, 35, { stroke: C.teal, strokeWidth: 3, roughness: 1.5 }));
      container.appendChild(rc.rectangle(1050, 680, 45, 35, { stroke: C.teal, strokeWidth: 2, fill: C.teal, fillStyle: 'solid' }));
      addText(1200, 704, 'TOKEN USAGE: 3.2% (PERFECT)', 'font-marker', 15, C.teal, 'middle');
      drawStamp(1070, 750, 260, 55, 'HIGH SIGNAL ACCURACY', C.teal, 3);
    `
  },

  // 6. Retrieval Funnel (Refined stages)
  {
    path: path.join(OUT_DIR_CONTEXT, 'retrieval-selection.webp'),
    name: 'context-engineering-funnel',
    code: `
      addText(800, 65, 'HIGH-SIGNAL RETRIEVAL FUNNEL', 'font-marker', 44, C.white, 'middle');
      addText(800, 105, 'Filtering out 95% noise before hitting the context window', 'font-kalam', 24, C.amber, 'middle');

      const fx = 800, fy = 190;
      // Funnel cone
      container.appendChild(rc.polygon([
        [fx - 360, fy + 80],
        [fx + 360, fy + 80],
        [fx + 100, fy + 450],
        [fx - 100, fy + 450]
      ], {
        stroke: C.white, strokeWidth: 5, roughness: 2.2, fill: 'rgba(30, 41, 59, 0.65)', fillStyle: 'solid'
      }));

      // Funnel Spout
      container.appendChild(rc.rectangle(fx - 100, fy + 450, 200, 90, {
        stroke: C.white, strokeWidth: 4.5, roughness: 1.8, fill: 'rgba(30, 41, 59, 0.8)', fillStyle: 'solid'
      }));

      // Raw Inputs
      addText(fx, fy + 35, 'RAW NOISY INPUTS (500,000 TOKENS)', 'font-marker', 26, C.coral, 'middle');
      addText(fx, fy + 65, 'Massive logs, 50-page docs, chat chit-chat, giant diffs', 'font-hand', 20, C.white, 'middle');

      // Stage 1
      container.appendChild(rc.line(fx - 290, fy + 175, fx + 290, fy + 175, { stroke: C.blue, strokeWidth: 4, strokeDash: [8, 8] }));
      addText(fx, fy + 155, 'STAGE 1: BM25 / Keyword Pre-filter (Discard 70%)', 'font-marker', 18, C.blue, 'middle');

      // Stage 2
      container.appendChild(rc.line(fx - 200, fy + 280, fx + 200, fy + 280, { stroke: C.purple, strokeWidth: 4, strokeDash: [6, 6] }));
      addText(fx, fy + 260, 'STAGE 2: Cross-Encoder & Semantic Re-ranking', 'font-marker', 18, C.purple, 'middle');

      // Stage 3
      container.appendChild(rc.line(fx - 130, fy + 380, fx + 130, fy + 380, { stroke: C.amber, strokeWidth: 4, strokeDash: [4, 4] }));
      addText(fx, fy + 360, 'STAGE 3: Deduplication & Recency Check', 'font-marker', 17, C.amber, 'middle');

      // Ejection Chute to Trash
      container.appendChild(rc.line(fx + 220, fy + 220, fx + 460, fy + 320, { stroke: C.coral, strokeWidth: 4.5 }));
      container.appendChild(rc.rectangle(fx + 420, fy + 320, 180, 200, {
        stroke: C.coral, strokeWidth: 4, roughness: 2, fill: 'rgba(248, 113, 113, 0.15)', fillStyle: 'cross-hatch', hachureGap: 14
      }));
      addText(fx + 510, fy + 390, 'NOISE TRASH', 'font-marker', 22, C.coral, 'middle');
      addText(fx + 510, fy + 430, '485,000 Tokens\\nDiscarded!\\n(97% Noise)', 'font-hand', 20, C.white, 'middle');

      // Pure Signal Packet
      container.appendChild(rc.rectangle(fx - 140, fy + 575, 280, 95, {
        stroke: C.teal, strokeWidth: 4.5, fill: 'rgba(45, 212, 191, 0.3)', fillStyle: 'solid', roughness: 1.8
      }));
      addText(fx, fy + 610, 'DENSE SIGNAL PACKET', 'font-marker', 22, C.teal, 'middle');
      addText(fx, fy + 640, '1,500 Tokens (100% Relevant!)', 'font-hand', 20, C.white, 'middle');

      // Robot with lab goggles
      drawRobot(260, 520, 1.1, { badgeText: 'SCIENTIST', badgeStroke: C.teal });
      speechBubble(120, 310, 260, 100, 260, 440, 'Only the pure golden\\nsignal enters my brain!\\nSuper fast!', {
        fontSize: 21, stroke: C.teal, textColor: C.teal
      });

      drawStamp(fx - 120, fy + 710, 240, 55, 'READY TO RUN', C.teal, 0);
    `
  },

  // 7. Compaction Memory (Refined vertical layout)
  {
    path: path.join(OUT_DIR_CONTEXT, 'compaction-memory.webp'),
    name: 'context-engineering-compaction',
    code: `
      addText(800, 65, 'PROGRESSIVE COMPACTION & TWO-TIER MEMORY', 'font-marker', 44, C.white, 'middle');
      addText(800, 105, 'Active working window squashed into checkpoints + durable long-term vault', 'font-kalam', 24, C.amber, 'middle');

      // TIER 1: ACTIVE WORKING WINDOW (UPPER HALF)
      container.appendChild(rc.rectangle(100, 150, 1400, 310, {
        stroke: C.blue, strokeWidth: 4, roughness: 2.2, fill: 'rgba(56, 189, 248, 0.06)', fillStyle: 'solid'
      }));
      addText(140, 190, 'TIER 1: ACTIVE WORKING WINDOW (IN-TOKEN BUDGET: 8K MAX)', 'font-marker', 22, C.blue);

      // Raw turns card
      container.appendChild(rc.rectangle(150, 225, 410, 185, {
        stroke: C.white, strokeWidth: 3, roughness: 2, fill: C.cardBg, fillStyle: 'solid'
      }));
      addText(355, 260, 'RAW CONVERSATION TURNS', 'font-marker', 18, C.white, 'middle');
      addText(355, 305, 'Turn 1 -> Turn 2 -> ... -> Turn 45\\n(75,000 tokens of banter & logs)', 'font-hand', 20, C.coral, 'middle');
      addText(355, 360, 'Token limit approaching!', 'font-hand', 18, C.amber, 'middle');

      // Hydraulic Squeeze Clamp
      container.appendChild(rc.polygon([[600, 280], [650, 320], [600, 360]], { stroke: C.amber, strokeWidth: 4, fill: C.amber, fillStyle: 'solid' }));
      addText(625, 255, 'COMPACT', 'font-marker', 16, C.amber, 'middle');

      // Compact Checkpoint Card
      container.appendChild(rc.rectangle(690, 220, 420, 200, {
        stroke: C.teal, strokeWidth: 4.5, fill: 'rgba(45, 212, 191, 0.2)', fillStyle: 'solid', roughness: 1.8
      }));
      addText(900, 255, 'CHECKPOINT SUMMARY (1.2K TOKENS)', 'font-marker', 18, C.teal, 'middle');
      addText(900, 290, '[x] Goal accomplished: Refactored parser', 'font-hand', 18, C.white, 'middle');
      addText(900, 320, '[x] Key fact: DB port changed to 5433', 'font-hand', 18, C.white, 'middle');
      addText(900, 350, '[>] In-flight task: Run integration test', 'font-hand', 18, C.amber, 'middle');
      addText(900, 380, '[!] Constraint: Do not alter auth tokens', 'font-hand', 18, C.coral, 'middle');

      // Helper robot
      drawRobot(1270, 320, 0.85, { badgeText: 'SQUASH', badgeStroke: C.teal });

      // Connecting Arrows in gap
      container.appendChild(rc.line(355, 410, 355, 510, { stroke: C.coral, strokeWidth: 3.5, strokeDash: [6, 6] }));
      addText(395, 480, '1. Offload Old Turns', 'font-marker', 14, C.coral);

      container.appendChild(rc.line(900, 510, 900, 420, { stroke: C.teal, strokeWidth: 3.5, strokeDash: [6, 6] }));
      addText(935, 480, '2. Targeted Recall (SQL/Vector)', 'font-marker', 14, C.teal);

      // TIER 2: DURABLE EXTERNAL STORAGE (LOWER HALF)
      container.appendChild(rc.rectangle(100, 515, 1400, 335, {
        stroke: C.amber, strokeWidth: 4, roughness: 2.2, fill: 'rgba(245, 158, 11, 0.06)', fillStyle: 'solid'
      }));
      addText(140, 555, 'TIER 2: DURABLE EXTERNAL VAULT (OUT-OF-TOKEN: UNLIMITED DISK)', 'font-marker', 22, C.amber);

      const drawers = [
        { x: 160, title: 'SQLITE DECISION LOG', desc: 'All turn inputs, tool calls,\\nand execution hashes' },
        { x: 570, title: 'ARTIFACT ARCHIVE', desc: 'Diff files, generated images,\\ncode patches & traces' },
        { x: 980, title: 'EPISODIC KNOWLEDGE', desc: 'Long-term user preferences\\nand system invariants' }
      ];

      drawers.forEach(d => {
        container.appendChild(rc.rectangle(d.x, 580, 380, 230, {
          stroke: C.white, strokeWidth: 3.5, roughness: 2, fill: C.cardBg, fillStyle: 'solid'
        }));
        container.appendChild(rc.rectangle(d.x + 140, 605, 100, 20, { stroke: C.amber, strokeWidth: 3, fill: C.amber, fillStyle: 'solid' }));
        addText(d.x + 190, 675, d.title, 'font-marker', 18, C.amber, 'middle');
        addText(d.x + 190, 730, d.desc, 'font-hand', 20, C.white, 'middle');
      });
    `
  },

  // 8. Subagent Isolation (Refined gap & trajectories)
  {
    path: path.join(OUT_DIR_CONTEXT, 'subagent-isolation.webp'),
    name: 'context-engineering-isolation',
    code: `
      addText(800, 65, 'SPECIALIST SUBAGENTS: CONTEXT ISOLATION', 'font-marker', 44, C.white, 'middle');
      addText(800, 105, 'Keep orchestrator context lean: Isolated sandboxes report summaries only', 'font-kalam', 24, C.amber, 'middle');

      // Top Lead Orchestrator
      drawRobot(800, 170, 0.9, { badgeText: 'CHIEF ORCHESTRATOR', badgeStroke: C.amber, headFill: 'rgba(245, 158, 11, 0.25)' });
      speechBubble(940, 110, 360, 90, 860, 155, '"Specialists: do deep work in your pods!\\nSend back 200-token summaries ONLY!"', {
        fontSize: 19, stroke: C.amber, textColor: C.white
      });

      // Warning banner across middle
      addText(800, 445, 'NO TOKEN EXPLOSION! ZERO CONTEXT CONTAMINATION!', 'font-marker', 18, C.amber, 'middle');

      // 3 Isolated Pods Below
      const pods = [
        { x: 90, y: 480, w: 420, h: 380, title: 'POD 1: RESEARCH SPECIALIST', subTitle: 'Reads 50,000 tokens of docs', color: C.teal, role: 'RESEARCH' },
        { x: 590, y: 480, w: 420, h: 380, title: 'POD 2: CODE SPECIALIST', subTitle: 'Executes 80,000 tokens of tests', color: C.blue, role: 'CODER' },
        { x: 1090, y: 480, w: 420, h: 380, title: 'POD 3: AUDIT SPECIALIST', subTitle: 'Runs 30,000 tokens of security', color: C.purple, role: 'AUDITOR' }
      ];

      pods.forEach(p => {
        container.appendChild(rc.rectangle(p.x, p.y, p.w, p.h, {
          stroke: p.color, strokeWidth: 4.5, roughness: 2.2, fill: 'rgba(23, 32, 48, 0.85)', fillStyle: 'solid'
        }));
        
        addText(p.x + p.w/2, p.y + 35, p.title, 'font-marker', 19, p.color, 'middle');
        addText(p.x + p.w/2, p.y + 65, p.subTitle, 'font-kalam', 16, C.white, 'middle');

        drawStamp(p.x + p.w/2 - 90, p.y + p.h - 50, 180, 38, 'SEALED SANDBOX', p.color, 0);

        drawRobot(p.x + p.w/2, p.y + 195, 0.85, { badgeText: p.role, badgeStroke: p.color });

        const startAirX = p.x + p.w/2;
        const startAirY = p.y;
        const endAirX = 800 + (p.x < 500 ? -70 : (p.x > 900 ? 70 : 0));
        const endAirY = 320;
        container.appendChild(rc.curve([[startAirX, startAirY], [(startAirX+endAirX)/2, (startAirY+endAirY)/2 - 25], [endAirX, endAirY]], {
          stroke: p.color, strokeWidth: 3.5, strokeDash: [6, 6]
        }));
      });

      // Airplanes summaries in the clear space
      container.appendChild(rc.rectangle(260, 355, 180, 55, { stroke: C.teal, strokeWidth: 2, fill: C.cardBg, fillStyle: 'solid' }));
      addText(350, 375, 'Summary: 2 papers', 'font-marker', 14, C.teal, 'middle');
      addText(350, 395, '180 tokens', 'font-hand', 15, C.white, 'middle');

      container.appendChild(rc.rectangle(710, 355, 180, 55, { stroke: C.blue, strokeWidth: 2, fill: C.cardBg, fillStyle: 'solid' }));
      addText(800, 375, 'Summary: Patch OK', 'font-marker', 14, C.blue, 'middle');
      addText(800, 395, '220 tokens', 'font-hand', 15, C.white, 'middle');

      container.appendChild(rc.rectangle(1160, 355, 180, 55, { stroke: C.purple, strokeWidth: 2, fill: C.cardBg, fillStyle: 'solid' }));
      addText(1250, 375, 'Summary: 0 CVEs', 'font-marker', 14, C.purple, 'middle');
      addText(1250, 395, '150 tokens', 'font-hand', 15, C.white, 'middle');
    `
  }
];

async function generateAll() {
  console.log('Launching Playwright Chromium for final polish rendering...');
  const browser = await chromium.launch();

  for (let i = 0; i < DIAGRAMS.length; i++) {
    const diag = DIAGRAMS[i];
    console.log(`[${i+1}/${DIAGRAMS.length}] Rendering ${diag.name} -> ${diag.path}...`);
    
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR in diagram:', err.message));

    const html = getBaseHtml(diag.code);
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600); // Allow fonts to settle

    await page.screenshot({ path: diag.path, type: 'webp', quality: 90 });
    console.log(`  Done: ${diag.path}`);
    await page.close();
  }

  await browser.close();
  console.log('ALL 8 REFINED CHALKBOARD DOODLE IMAGES GENERATED SUCCESSFULLY!');
}

generateAll().catch(console.error);
