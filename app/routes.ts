import { type RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";

// Mismas rutas por convención de archivos de siempre (app/routes/*.tsx, con "." y "_" como
// en Remix 2): React Router 7 solo pide declararlo aquí en lugar de asumirlo.
export default flatRoutes() satisfies RouteConfig;
