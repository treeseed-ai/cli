import { ProjectTooling } from '@treeseed-cordis/sdk/source-policy';
class CliBuild {
  static async run():Promise<void> {
    ProjectTooling.run();
    if(process.argv[2]==='build') {
      const result=await Bun.build({entrypoints:['./src/main.ts'],compile:{target:'bun-linux-x64',outfile:'./dist/trsd-linux-x64',autoloadDotenv:false,autoloadBunfig:false,autoloadTsconfig:false,autoloadPackageJson:true},minify:true});
      if(!result.success)throw new Error('Standalone compilation failed');
    }
  }
}
await CliBuild.run();
