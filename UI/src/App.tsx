import { TooltipProvider } from "@/components/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Index from "./pages/Index";

const queryClient = new QueryClient();

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Index />
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
