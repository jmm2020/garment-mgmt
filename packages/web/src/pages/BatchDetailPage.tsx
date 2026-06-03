import { useParams } from "react-router-dom";

export function BatchDetailPage() {
  const { ref } = useParams<{ ref: string }>();
  if (!ref) return null;
  return (
    <div>
      <h1>Batch {ref}</h1>
      {/* TODO iter 3: useQuery({ queryKey: ['batches', ref], queryFn: () => get<BatchSummary>('/api/batches/' + ref) }) */}
      <p>TODO: batch detail</p>
    </div>
  );
}
