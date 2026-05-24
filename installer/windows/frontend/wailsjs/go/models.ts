export namespace main {
	
	export class ReleaseInfo {
	    tag: string;
	    prerelease: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ReleaseInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tag = source["tag"];
	        this.prerelease = source["prerelease"];
	    }
	}

}

