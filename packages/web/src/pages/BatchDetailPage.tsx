import { useParams } from "react-router-dom";

export function BatchDetailPage() {
  const { ref = "" } = useParams();
  return (
    <div>
      <h1>Batch {ref}</h1>
      {/* TODO: batch detail via useQuery(get(`/api/batches/${ref}`)) — iter 3 */}
      <p>TODO: batch detail</p>
    </div>
  );
}
