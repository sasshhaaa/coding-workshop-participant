import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The page talks to the auth service directly, so that module is mocked
// rather than the network underneath it.
vi.mock("../services/auth", async () => {
  const actual = await vi.importActual("../services/auth");
  return {
    ...actual,
    authApi: {
      login: vi.fn(),
      register: vi.fn(),
    },
    setToken: vi.fn(),
  };
});

import Login from "./Login";
import { authApi, setToken } from "../services/auth";

const SESSION = {
  token: "abc.def.ghi",
  user: { id: 1, email: "sasha@acme.com", name: "Sasha", role: "admin" },
};

function setup() {
  const onSignedIn = vi.fn();
  render(<Login onSignedIn={onSignedIn} />);
  return { onSignedIn, user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the sign in form", () => {
  it("opens on sign in rather than registration", () => {
    setup();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
  });

  it("masks the password", () => {
    setup();
    expect(screen.getByLabelText(/password/i)).toHaveAttribute("type", "password");
  });

  it("signs in with what was typed", async () => {
    authApi.login.mockResolvedValue(SESSION);
    const { onSignedIn, user } = setup();

    await user.type(screen.getByLabelText(/email/i), "sasha@acme.com");
    await user.type(screen.getByLabelText(/password/i), "workshop123");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() =>
      expect(authApi.login).toHaveBeenCalledWith("sasha@acme.com", "workshop123")
    );
  });

  it("stores the token and hands the user up on success", async () => {
    authApi.login.mockResolvedValue(SESSION);
    const { onSignedIn, user } = setup();

    await user.type(screen.getByLabelText(/email/i), "sasha@acme.com");
    await user.type(screen.getByLabelText(/password/i), "workshop123");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(setToken).toHaveBeenCalledWith("abc.def.ghi");
      expect(onSignedIn).toHaveBeenCalledWith(SESSION.user);
    });
  });

  it("shows the server's message when credentials are wrong", async () => {
    authApi.login.mockRejectedValue({
      response: { data: { error: "Email or password is incorrect" } },
    });
    const { onSignedIn, user } = setup();

    await user.type(screen.getByLabelText(/email/i), "sasha@acme.com");
    await user.type(screen.getByLabelText(/password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByText(/incorrect/i)).toBeInTheDocument();
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(setToken).not.toHaveBeenCalled();
  });

  it("keeps the email in the box after a failure", async () => {
    // Retyping an address because the password was wrong is needless friction.
    authApi.login.mockRejectedValue({ message: "Network Error" });
    const { user } = setup();

    await user.type(screen.getByLabelText(/email/i), "sasha@acme.com");
    await user.type(screen.getByLabelText(/password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await screen.findByText(/network error/i);
    expect(screen.getByLabelText(/email/i)).toHaveValue("sasha@acme.com");
  });

  it("signs in when Enter is pressed", async () => {
    authApi.login.mockResolvedValue(SESSION);
    const { user } = setup();

    await user.type(screen.getByLabelText(/email/i), "sasha@acme.com");
    await user.type(screen.getByLabelText(/password/i), "workshop123{Enter}");

    await waitFor(() => expect(authApi.login).toHaveBeenCalled());
  });
});

describe("the registration form", () => {
  it("appears when the tab is chosen", async () => {
    const { user } = setup();

    await user.click(screen.getByRole("tab", { name: /create account/i }));

    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create account/i })
    ).toBeInTheDocument();
  });

  it("says new accounts are read-only", async () => {
    // Otherwise a new user hunts for buttons that were never going to be
    // there, and assumes the app is broken.
    const { user } = setup();

    await user.click(screen.getByRole("tab", { name: /create account/i }));

    expect(screen.getByText(/read-only access/i)).toBeInTheDocument();
  });

  it("offers no way to pick a role", async () => {
    // Choosing your own role would be privilege escalation. The backend
    // ignores it too, but the form shouldn't suggest it's possible.
    const { user } = setup();

    await user.click(screen.getByRole("tab", { name: /create account/i }));

    expect(screen.queryByLabelText(/role/i)).not.toBeInTheDocument();
  });

  it("registers with what was typed", async () => {
    authApi.register.mockResolvedValue(SESSION);
    const { user } = setup();

    await user.click(screen.getByRole("tab", { name: /create account/i }));
    await user.type(screen.getByLabelText(/full name/i), "New Person");
    await user.type(screen.getByLabelText(/email/i), "new@acme.com");
    await user.type(screen.getByLabelText(/password/i), "workshop123");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() =>
      expect(authApi.register).toHaveBeenCalledWith({
        email: "new@acme.com",
        name: "New Person",
        password: "workshop123",
      })
    );
  });

  it("signs the new user straight in", async () => {
    authApi.register.mockResolvedValue(SESSION);
    const { onSignedIn, user } = setup();

    await user.click(screen.getByRole("tab", { name: /create account/i }));
    await user.type(screen.getByLabelText(/full name/i), "New Person");
    await user.type(screen.getByLabelText(/email/i), "new@acme.com");
    await user.type(screen.getByLabelText(/password/i), "workshop123");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(setToken).toHaveBeenCalledWith("abc.def.ghi");
      expect(onSignedIn).toHaveBeenCalled();
    });
  });

  it("reports a duplicate email", async () => {
    authApi.register.mockRejectedValue({
      response: {
        data: { details: ["an account with that email already exists"] },
      },
    });
    const { onSignedIn, user } = setup();

    await user.click(screen.getByRole("tab", { name: /create account/i }));
    await user.type(screen.getByLabelText(/full name/i), "Sasha");
    await user.type(screen.getByLabelText(/email/i), "sasha@acme.com");
    await user.type(screen.getByLabelText(/password/i), "workshop123");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});

describe("switching tabs", () => {
  it("clears an error so it doesn't linger on the other form", async () => {
    authApi.login.mockRejectedValue({ message: "Network Error" });
    const { user } = setup();

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    await screen.findByText(/network error/i);

    await user.click(screen.getByRole("tab", { name: /create account/i }));

    expect(screen.queryByText(/network error/i)).not.toBeInTheDocument();
  });
});