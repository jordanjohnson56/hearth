import { clientFeatureList } from '../features/registry.client.js';

export function App() {
  return (
    <>
      <main>
        <h1>Hearth</h1>
      </main>
      {/* Minimal: entries come from the client registry. The real app shell replaces this later in M0. */}
      <nav aria-label="Main">
        <ul>
          <li>
            <a href="/">Home</a>
          </li>
          {clientFeatureList.map((feature) => (
            <li key={feature.id}>
              <a href={`/${feature.id}`}>{feature.name}</a>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
