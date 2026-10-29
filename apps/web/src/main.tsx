import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { api, ApiError, type Me } from "./api";
import { DraftPage } from "./pages/Draft";
import { LoginPage } from "./pages/Login";
import { NewSitePage } from "./pages/NewSite";
import { SettingsPage } from "./pages/Settings";
import { SitePage } from "./pages/Site";
import { SitesPage } from "./pages/Sites";
import { Link, match, navigate, usePath } from "./router";
import "./styles.css";
import { Loading, Logo, Meter, Notice, ThemeSwitch, useLoad } from "./ui";

function App() {
  const { path } = usePath();
  const me = useLoad<Me | "signed-out">(
    () =>
      api<Me>("GET", "/me").catch((e) =>
        e instanceof ApiError && e.status === 401 ? "signed-out" : Promise.reject(e),
      ),
    [],
  );

  const onLogin = path === "/app/login";
  useEffect(() => {
    if (me.data === "signed-out" && !onLogin) navigate("/app/login");
  }, [me.data, onLogin]);

  if (onLogin) return <LoginPage />;
  if (me.error) return <Notice kind="error">{me.error}</Notice>;
  if (!me.data || me.data === "signed-out") return <Loading />;

  let page;
  let m;
  if (path === "/app") page = <SitesPage />;
  else if (path === "/app/sites/new") page = <NewSitePage />;
  else if ((m = match("/app/sites/:id", path))) page = <SitePage id={m.id!} />;
  else if ((m = match("/app/drafts/:id", path))) page = <DraftPage id={m.id!} />;
  else if (path === "/app/settings") page = <SettingsPage me={me.data} reloadMe={me.reload} />;
  else
    page = (
      <Notice>
        That page doesn't exist. <Link href="/app">Go to your sites</Link>.
      </Notice>
    );

  return (
    <>
      <header className="bar">
        <div className="bar-in">
          <Link className="brand" href="/app">
            <Logo />
            <span>Rankkiln</span>
          </Link>
          <nav className="bar-nav" aria-label="Main">
            <Link href="/app" className={path === "/app" || path.startsWith("/app/sites") ? "on" : ""}>
              Sites
            </Link>
            <Link href="/app/settings" className={path === "/app/settings" ? "on" : ""}>
              Settings
            </Link>
          </nav>
          <div className="bar-end">
            <Link href="/app/settings" className="usage" title="Posts used this month">
              <span className="usage-text">
                {me.data.usage.posts}/{me.data.plan.postsPerMonth}
                <span className="hide-sm"> posts</span>
              </span>
              <Meter value={me.data.usage.posts} max={me.data.plan.postsPerMonth} />
            </Link>
            <ThemeSwitch />
          </div>
        </div>
      </header>
      <main className="page">{page}</main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
