import { createTheme } from "@mui/material/styles";

// Citi palette
const NAVY = "#002D72";      // chrome, headings
const BLUE = "#0B5CD5";      // primary actions
const BLUE_TINT = "#E8F0FC"; // selected / lead cards
const RED = "#D62B1F";       // Citi arc — alerts and destructive only
const AMBER = "#B25E00";     // warnings (readable on tint)
const INK = "#12233F";
const MUTED = "#5A6B85";
const LINE = "#DCE3ED";

const theme = createTheme({
  spacing: 10,

  palette: {
    primary: { main: BLUE, dark: NAVY, light: BLUE_TINT, contrastText: "#fff" },
    secondary: { main: NAVY },
    error: { main: RED, light: "#FDECEA", dark: "#9E1B12" },
    warning: { main: AMBER, light: "#FFF4E5", dark: "#8A4700" },
    success: { main: "#1B7F4B", light: "#E7F4ED" },
    background: { default: "#F6F8FB", paper: "#FFFFFF" },
    text: { primary: INK, secondary: MUTED },
    divider: LINE,
    grey: { 100: "#F1F4F9", 200: "#E5EAF2" },
  },

  typography: {
    fontFamily: '"Inter","Segoe UI",Roboto,Helvetica,Arial,sans-serif',
    fontSize: 15,
    h5: { fontWeight: 600, fontSize: "1.6rem", color: NAVY, letterSpacing: "-0.01em" },
    h6: { fontWeight: 600, fontSize: "1.25rem", color: NAVY, letterSpacing: "-0.01em" },
    subtitle1: { fontSize: "1.05rem" },
    subtitle2: {
      fontWeight: 600, color: NAVY, textTransform: "uppercase",
      fontSize: 13, letterSpacing: "0.06em",
    },
    body1: { fontSize: "1rem" },
    body2: { fontSize: "0.95rem" },
    caption: { fontSize: "0.825rem", lineHeight: 1.6 },
    button: { textTransform: "none", fontWeight: 600, fontSize: "0.95rem" },
  },

  shape: { borderRadius: 8 },

  components: {
    MuiAppBar: {
      styleOverrides: {
        root: { backgroundColor: NAVY, backgroundImage: "none", boxShadow: "none" },
      },
    },
    MuiCard: {
      styleOverrides: { root: { border: `1px solid ${LINE}`, boxShadow: "none" } },
    },
    MuiCardContent: {
      styleOverrides: {
        root: { padding: 20, "&:last-child": { paddingBottom: 20 } },
      },
    },
    MuiPaper: { styleOverrides: { rounded: { borderRadius: 8 } } },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 6, paddingInline: 18, paddingBlock: 8 },
        containedPrimary: {
          boxShadow: "none",
          "&:hover": { backgroundColor: NAVY, boxShadow: "none" },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, fontSize: 12.5, height: 26 },
      },
    },
    MuiDivider: { styleOverrides: { root: { borderColor: LINE } } },
    MuiIconButton: {
      styleOverrides: {
        root: { padding: 8, "&:hover": { backgroundColor: BLUE_TINT } },
      },
    },
    MuiTextField: { defaultProps: { size: "small" } },
    MuiTooltip: {
      styleOverrides: { tooltip: { fontSize: 12.5 } },
    },
  },
});

export default theme;