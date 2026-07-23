import {
  Dialog, DialogTitle, DialogContent, DialogContentText,
  DialogActions, Button, Alert,
} from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

/**
 * Replaces window.confirm so destructive actions match the rest of the app.
 *
 * `open` is driven by the request object itself rather than a boolean, so the
 * dialog always knows what it is confirming and can't be left open with
 * nothing selected.
 */
export default function ConfirmDialog({
  open,
  title = "Are you sure?",
  message,
  consequence,
  confirmLabel = "Delete",
  onConfirm,
  onClose,
  busy = false,
}) {
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle sx={{
        display: "flex", alignItems: "center", gap: 1.5, pb: 1,
      }}>
        <WarningAmberIcon color="error" />
        {title}
      </DialogTitle>

      <DialogContent>
        <DialogContentText sx={{ color: "text.primary" }}>
          {message}
        </DialogContentText>

        {consequence && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {consequence}
          </Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={onConfirm}
          disabled={busy}
          autoFocus
        >
          {busy ? "Deleting…" : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}