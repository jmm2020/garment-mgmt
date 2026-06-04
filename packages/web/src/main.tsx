import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterComponent } from "./router.js";
import { ApiError } from "./api/types.js";

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError(error) {
      if (error instanceof ApiError && error.status === 401) {
        // Session expired or missing — clear cache and redirect to login.
        queryClient.clear();
        window.location.replace("/login");
      }
    },
  }),
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

const el = document.getElementById("root");
if (!el) throw new Error("Root element not found");

createRoot(el).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <RouterComponent />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
