import { useState, useEffect, useCallback } from "react";
import {
  Box, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, Alert, Snackbar, Typography, CircularProgress,
  Chip, IconButton, Stack,
} from "@mui/material";
import { DataGrid } from "@mui/x-data-grid";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import AddIcon from "@mui/icons-material/Add";
import { useMediaQuery } from "react-responsive";
import { projectsApi, STATUSES } from "../services/api";

const EMPTY = {
  name: "", department: "", status: "planning",
  start_date: "", due_date: "", budget_planned: 0, budget_spent: 0,
};

const STATUS_COLOR = {
  planning: "default", active: "primary", on_hold: "warning",
  completed: "success", cancelled: "error",
};

export default function Projects() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const isMobile = useMediaQuery({ maxWidth: 768 });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await projectsApi.getAll());
    } catch (e) {
      setError(e.response?.data?.message || e.message || "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const validate = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (form.start_date && form.due_date && form.start_date > form.due_date) {
      errs.due_date = "Due date must be after start date";
    }
    if (Number(form.budget_spent) < 0) errs.budget_spent = "Cannot be negative";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    const payload = {
      ...form,
      start_date: form.start_date || null,
      due_date: form.due_date || null,
      budget_planned: Number(form.budget_planned) || 0,
      budget_spent: Number(form.budget_spent) || 0,
    };
    try {
      if (editId) {
        await projectsApi.update(editId, payload);
        setToast("Project updated");
      } else {
        await projectsApi.create(payload);
        setToast("Project created");
      }
      setOpen(false);
      load();
    } catch (e) {
      setError(e.response?.data?.details?.join(", ") || e.message);
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this project?")) return;
    try {
      await projectsApi.remove(id);
      setToast("Project deleted");
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const openNew = () => {
    setForm(EMPTY); setEditId(null); setFieldErrors({}); setOpen(true);
  };

  const openEdit = (row) => {
    setForm({
      name: row.name || "",
      department: row.department || "",
      status: row.status || "planning",
      start_date: row.start_date || "",
      due_date: row.due_date || "",
      budget_planned: row.budget_planned || 0,
      budget_spent: row.budget_spent || 0,
    });
    setEditId(row.id); setFieldErrors({}); setOpen(true);
  };

  const columns = [
    { field: "id", headerName: "ID", width: 70 },
    { field: "name", headerName: "Project", flex: 1, minWidth: 180 },
    { field: "department", headerName: "Department", width: 140 },
    {
      field: "status", headerName: "Status", width: 130,
      renderCell: (p) => (
        <Chip label={p.value} size="small" color={STATUS_COLOR[p.value] || "default"} />
      ),
    },
    { field: "due_date", headerName: "Due", width: 120 },
    {
      field: "budget", headerName: "Budget Used", width: 150,
      valueGetter: (v, row) => {
        const planned = Number(row.budget_planned) || 0;
        const spent = Number(row.budget_spent) || 0;
        return planned ? `${Math.round((spent / planned) * 100)}%` : "—";
      },
    },
    {
      field: "actions", headerName: "Actions", width: 110, sortable: false,
      renderCell: (p) => (
        <Stack direction="row">
          <IconButton size="small" onClick={() => openEdit(p.row)}><EditIcon fontSize="small" /></IconButton>
          <IconButton size="small" color="error" onClick={() => remove(p.row.id)}><DeleteIcon fontSize="small" /></IconButton>
        </Stack>
      ),
    },
  ];

  return (
    <Box sx={{ p: isMobile ? 1 : 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant={isMobile ? "h6" : "h5"}>Projects</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>
          New Project
        </Button>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError("")} sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>
      ) : (
        <div style={{ width: "100%" }}>
          <DataGrid
            rows={rows}
            columns={columns}
            autoHeight
            pageSizeOptions={[5, 10, 25]}
            initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
            disableRowSelectionOnClick
            showToolbar
          />
        </div>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm" fullScreen={isMobile}>
        <DialogTitle>{editId ? "Edit Project" : "New Project"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <TextField
              label="Name" required value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              error={!!fieldErrors.name} helperText={fieldErrors.name} fullWidth
            />
            <TextField
              label="Department" value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })} fullWidth
            />
            <TextField
              select label="Status" value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })} fullWidth
            >
              {STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
            <TextField
              label="Start Date" type="date" InputLabelProps={{ shrink: true }}
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })} fullWidth
            />
            <TextField
              label="Due Date" type="date" InputLabelProps={{ shrink: true }}
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              error={!!fieldErrors.due_date} helperText={fieldErrors.due_date} fullWidth
            />
            <TextField
              label="Budget Planned" type="number" value={form.budget_planned}
              onChange={(e) => setForm({ ...form, budget_planned: e.target.value })} fullWidth
            />
            <TextField
              label="Budget Spent" type="number" value={form.budget_spent}
              onChange={(e) => setForm({ ...form, budget_spent: e.target.value })}
              error={!!fieldErrors.budget_spent} helperText={fieldErrors.budget_spent} fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save}>Save</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!toast} autoHideDuration={3000} onClose={() => setToast("")} message={toast}
      />
    </Box>
  );
}