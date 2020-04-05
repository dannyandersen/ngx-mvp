# Model-View-Presenter schematics for Angular

This repository is based on an article by Lars Gyrup Brink Nielsen:

https://indepth.dev/model-view-presenter-with-angular/

### Install

This should be installed in devDependencies to make sure it is not distributed with your application.

```bash
npm install ng-mvp --save-dev
```

### How to use it

Once installed, you can generate code in the same way you use `ng generate component your-component` or `ng g c your-component` for short.

This is how you generate 

```bash
ng generate ng-mvp:container your-component
```

To add a presenter simply add the `--presenter` parameter.

```bash
ng generate ng-mvp:container your-component --presenter
```
 