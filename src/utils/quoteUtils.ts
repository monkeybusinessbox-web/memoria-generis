/**
 * Converts straight and curly double quotation marks (" “ ” „ ‟)
 * into Russian typographic guillemets (« ») based on context.
 */
export function convertQuotesToGuillemets(text: string): string {
  if (!/[""“”„‟]/.test(text)) return text;

  let result = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === '“' || ch === '”' || ch === '„' || ch === '‟') {
      if (ch === '„') {
        result += '«';
        continue;
      }
      if (ch === '”') {
        result += '»';
        continue;
      }
      const prev = i > 0 ? result[i - 1] : '';
      const isOpening =
        i === 0 || /[\s(\[{—–\-\/„:]/.test(prev);
      result += isOpening ? '«' : '»';
    } else {
      result += ch;
    }
  }
  return result;
}
