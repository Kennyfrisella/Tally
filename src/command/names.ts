// Surnames from all four language regions, as you would find them in any Swiss Army unit.
const SURNAMES = [
  'Müller', 'Meier', 'Schmid', 'Keller', 'Weber', 'Huber', 'Schneider', 'Steiner', 'Brunner', 'Baumann', 'Gerber', 'Zimmermann',
  'Arnold', 'Gisler', 'Imhof', 'Zgraggen', 'Herger', 'Planzer', 'Walker', 'Furrer', 'Tresch', 'Aschwanden', 'Indergand',
  'Favre', 'Rochat', 'Perrin', 'Bonvin', 'Dubois', 'Python', 'Clément', 'Monnier', 'Jaquier',
  'Bernasconi', 'Ferrari', 'Rossi', 'Lepori', 'Bianchi', 'Pedrazzini', 'Guscetti', 'Delcò',
  'Caduff', 'Cathomen', 'Casanova', 'Derungs', 'Cavegn', 'Tuor',
];
const FIRST = ['Luca', 'Noah', 'Jan', 'Nico', 'Simon', 'Marco', 'Lukas', 'Fabian', 'Yannick', 'Joël', 'Mathieu', 'Loïc', 'Matteo', 'Gian', 'Elia', 'Lea', 'Sara', 'Nina', 'Chiara', 'Céline'];

export function makeNamer(seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const used = new Set<string>();
  return () => {
    for (let i = 0; i < 50; i++) {
      const n = SURNAMES[Math.floor(rnd() * SURNAMES.length)];
      if (!used.has(n)) { used.add(n); return { last: n, first: FIRST[Math.floor(rnd() * FIRST.length)] }; }
    }
    return { last: SURNAMES[Math.floor(rnd() * SURNAMES.length)], first: 'Tim' };
  };
}
