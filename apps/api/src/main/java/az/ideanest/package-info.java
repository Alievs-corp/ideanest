/**
 * IdeyaNest API — a modular monolith.
 *
 * <p>Packages are organised <strong>by feature, not by layer</strong>. Everything
 * about pledging lives under {@code pledge}; there is no repository package
 * holding every repository in the service. The boundary that matters is the
 * module, and keeping it visible is what makes extracting one into its own
 * service later a contained piece of work rather than an archaeology project.
 *
 * <p>Within a module the layers are:
 *
 * <ul>
 *   <li>{@code domain} — entities, value objects, and the rules that hold
 *       regardless of how the module is called</li>
 *   <li>{@code application} — services and use cases; the transaction boundary</li>
 *   <li>{@code infrastructure} — repositories, clients, and other adapters</li>
 *   <li>{@code api} — controllers and the request and response types they bind</li>
 * </ul>
 *
 * <p>A module reaches another module through its {@code application} layer only.
 * Reaching into another module's {@code domain} or {@code infrastructure}
 * couples the two to each other's internals and removes the point of the
 * boundary.
 *
 * <p>Not every module has code yet. The package and its description exist so
 * that code lands where the architecture says it belongs, rather than wherever
 * the first commit happened to put it. The full layout is in
 * {@code docs/architecture.md} §16.
 */
package az.ideanest;
