import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { LoginPage } from "../src/pages/LoginPage.js";
import * as client from "../src/api/client.js";
import { ApiError } from "../src/api/types.js";

function renderLogin() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LoginPage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("calls login() with entered credentials on submit", async () => {
    const loginSpy = vi.spyOn(client, "login").mockResolvedValue(undefined);
    renderLogin();

    await userEvent.type(screen.getByLabelText(/email/i), "user@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "secret");
    await userEvent.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() =>
      expect(loginSpy).toHaveBeenCalledWith("user@example.com", "secret"),
    );
  });

  it("shows error message on ApiError from login()", async () => {
    vi.spyOn(client, "login").mockRejectedValue(
      new ApiError("auth.invalid_credentials", "Invalid email or password", 401),
    );
    renderLogin();

    await userEvent.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() => screen.getByText("Invalid email or password"));
  });

  it("shows generic error on non-ApiError (network failure)", async () => {
    vi.spyOn(client, "login").mockRejectedValue(new TypeError("Failed to fetch"));
    renderLogin();

    await userEvent.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() => screen.getByText(/network error/i));
  });

  it("clears previous error on retry submit", async () => {
    const loginSpy = vi
      .spyOn(client, "login")
      .mockRejectedValueOnce(new ApiError("auth.invalid_credentials", "Bad credentials", 401))
      .mockResolvedValueOnce(undefined);
    renderLogin();

    await userEvent.click(screen.getByRole("button", { name: /log in/i }));
    await waitFor(() => screen.getByText("Bad credentials"));

    await userEvent.click(screen.getByRole("button", { name: /log in/i }));
    await waitFor(() => expect(loginSpy).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Bad credentials")).toBeNull();
  });

  it("disables submit button while request is in-flight", async () => {
    let resolve!: () => void;
    vi.spyOn(client, "login").mockReturnValue(
      new Promise<void>((res) => { resolve = res; }),
    );
    renderLogin();

    await userEvent.click(screen.getByRole("button", { name: /log in/i }));

    const btn = screen.getByRole("button", { name: /logging in/i });
    expect(btn.hasAttribute("disabled")).toBe(true);
    resolve();
  });
});
