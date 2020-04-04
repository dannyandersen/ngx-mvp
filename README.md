# Model-View-Presenter schematics for Angular

This repository is based on an article by Lars Gyrup Brink Nielsen:

https://indepth.dev/model-view-presenter-with-angular/

### Install

```bash
npm i ng-mvp
```

### How to use it

Once installed, you can generate code in the same way you use `ng generate component your-component` or `ng g c your-component` for short.

This is how you generate 

```bash
np generate ng-mvp:container your-component
```

To add a presenter simply add the `--presenter` parameter.

```bash
np generate ng-mvp:container your-component --presenter
```
 