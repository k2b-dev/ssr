import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({
  url: "https://example.test/app?view=alpha",
  settings: { navigation: { disableChildPageNavigation: true } },
});
