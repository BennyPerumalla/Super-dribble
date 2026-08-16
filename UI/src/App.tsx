
import { TooltipProvider } from "@/components/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Index from "./pages/Index";

const queryClient = new QueryClient();

const App = () => {
  // Enable dark mode by default for the audio equalizer theme
  document.documentElement.classList.add("dark");

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Index />
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
