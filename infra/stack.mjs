import { App, Stack, Duration, CfnOutput, RemovalPolicy } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class MicroDramaPitcherStack extends Stack {
 constructor(scope, id, props) {
   super(scope, id, props);

   const videoBucket = new s3.Bucket(this, "VideoBucket", {
     removalPolicy: RemovalPolicy.DESTROY,
     autoDeleteObjects: true,
     cors: [{ allowedMethods: [s3.HttpMethods.GET], allowedOrigins: ["*"], allowedHeaders: ["*"] }],
   });

   const fn = new lambda.Function(this, "GenerateHandler", {
     runtime: lambda.Runtime.NODEJS_20_X,
     handler: "lambda.handler",
     code: lambda.Code.fromAsset(path.join(__dirname, "../server"), {
       bundling: {
         image: lambda.Runtime.NODEJS_20_X.bundlingImage,
         command: ["bash", "-c", "npm ci --omit=dev && cp -r . /asset-output"],
         local: {
           tryBundle(outputDir) {
             const serverDir = path.join(__dirname, "../server");
             execSync(`cp -r ${serverDir}/* ${outputDir}/ && cd ${outputDir} && npm ci --omit=dev`);
             return true;
           },
         },
       },
     }),
     timeout: Duration.minutes(15),
     memorySize: 512,
     environment: {
       S3_VIDEO_BUCKET: videoBucket.bucketName,
     },
   });

   fn.addToRolePolicy(new iam.PolicyStatement({
     actions: ["bedrock:InvokeModel", "bedrock:StartAsyncInvoke", "bedrock:GetAsyncInvoke"],
     resources: ["*"],
   }));
   videoBucket.grantReadWrite(fn);

   const api = new HttpApi(this, "Api", { corsPreflight: { allowOrigins: ["*"], allowMethods: [HttpMethod.POST, HttpMethod.OPTIONS], allowHeaders: ["Content-Type"] } });
   const integration = new HttpLambdaIntegration("LambdaIntegration", fn);
   api.addRoutes({ path: "/api/generate", methods: [HttpMethod.POST], integration });

   const siteBucket = new s3.Bucket(this, "SiteBucket", {
     removalPolicy: RemovalPolicy.DESTROY,
     autoDeleteObjects: true,
     blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
   });

   const oai = new cloudfront.OriginAccessIdentity(this, "OAI");
   siteBucket.grantRead(oai);

   const distribution = new cloudfront.Distribution(this, "Distribution", {
     defaultBehavior: {
       origin: new origins.S3Origin(siteBucket, { originAccessIdentity: oai }),
     },
     additionalBehaviors: {
       "/api/*": {
         origin: new origins.HttpOrigin(`${api.apiId}.execute-api.${this.region}.amazonaws.com`),
         allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
         cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
         originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
       },
     },
     defaultRootObject: "index.html",
     errorResponses: [{ httpStatus: 403, responsePagePath: "/index.html", responseHttpStatus: 200 }],
   });

   new s3deploy.BucketDeployment(this, "DeploySite", {
     sources: [s3deploy.Source.asset(path.join(__dirname, "../client/dist"))],
     destinationBucket: siteBucket,
     distribution,
     distributionPaths: ["/*"],
   });

   new CfnOutput(this, "SiteUrl", { value: `https://${distribution.distributionDomainName}` });
   new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
 }
}

const app = new App();
new MicroDramaPitcherStack(app, "MicroDramaPitcherStack", {
 env: { region: process.env.CDK_DEFAULT_REGION || "us-east-1" },
});
