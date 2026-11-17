// Neon arcade look: deep indigo background, electric yellow points, cyan/pink/purple accents.
export const colors = {
  bg: '#0B0820',
  card: '#17123A',
  cardAlt: '#221A4D',
  border: '#3A2F78',
  text: '#F6F4FF',
  muted: '#A79FD1',
  accent: '#FFE14D', // points, primary buttons
  accentEdge: '#C99A00',
  accentText: '#2A1E00',
  neon: '#2EF2FF',
  neonEdge: '#0A9DB0',
  pink: '#FF3EC8',
  pinkEdge: '#A3167D',
  purple: '#9B6BFF',
  purpleEdge: '#5B33C2',
  win: '#3DFF8F',
  winEdge: '#11A851',
  loss: '#FF3B4F',
  lossEdge: '#A3101F',
  push: '#A79FD1',
  gold: '#FFD23F',
  silver: '#CFD8EA',
  bronze: '#E08A4C',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

/** A soft neon glow for headline text. */
export const glow = (color: string, radius = 12) => ({
  textShadowColor: color,
  textShadowOffset: { width: 0, height: 0 },
  textShadowRadius: radius,
});

export const kindColor = { daily: colors.neon, weekly: colors.pink, monthly: colors.purple } as const;
