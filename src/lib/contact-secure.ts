// Contact details are stored XOR-obfuscated so the plain email/phone
// never appears in SSR HTML or as a greppable string in the JS bundle.
// Decoded only at runtime when the user opens the contact dialog.
const KEY = 0x5a;

const E = [44, 51, 63, 46, 62, 53, 53, 26, 53, 47, 46, 54, 53, 53, 49, 116, 57, 53, 55];
const P = [106, 98, 110, 111, 98, 110, 108, 109, 98, 98];

function decode(part: number[]): string {
  return part.map((c) => String.fromCharCode(c ^ KEY)).join("");
}

export interface ContactDetails {
  email: string;
  phone: string;
  mailto: string;
  zalo: string;
}

export function getContactDetails(): ContactDetails {
  const email = decode(E);
  const phone = decode(P);
  return {
    email,
    phone,
    mailto: decode([55, 59, 51, 54, 46, 53, 96]) + email,
    zalo: decode([50, 46, 46, 42, 41, 96, 117, 117, 32, 59, 54, 53, 116, 55, 63, 117]) + phone,
  };
}
