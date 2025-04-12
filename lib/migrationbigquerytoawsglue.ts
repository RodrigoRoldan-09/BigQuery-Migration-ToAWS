import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import * as path from 'path';
import { Bucket, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import * as cdk from 'aws-cdk-lib';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export class BigQueryToGlueStack extends cdk.Stack {

  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      env: { account: 'Your-Account-ID', region: 'Your-Region' } // Replace with your AWS account and region
    });

    // Create S3 Bucket to store scripts and connector
    const bucket = new Bucket(this, 'GlueScriptBucket', {
      bucketName: 'your-script-bucket-name',  //replace with the unique name that your bucket is going to have
      versioned: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Upload Python Glue script to S3
    new s3deploy.BucketDeployment(this, 'DeployGlueScript', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../src'))], //script with the information for the aws migration
      destinationBucket: bucket,
      destinationKeyPrefix: 'scripts/', //folder name were the script is going to be saved
      retainOnDelete: false,
      prune: true,
    });

    // Upload JDBC connector JAR to S3
    new s3deploy.BucketDeployment(this, 'DeployJdbcConnector', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../src/GoogleBigQueryJDBC42.jar'))], //your .jar required to create the glue connection with bigquery
      destinationBucket: bucket,
      destinationKeyPrefix: 'JDBC-connector/', //the connector
      retainOnDelete: false,
      prune: true,
    });

    // Reference to an existing VPC
    const vpc = ec2.Vpc.fromLookup(this, 'ExistingVPC', { vpcId: 'vpc-xxxxxxxxxxxxxxxxx' }); //replace with the name of your real vpc of your account

    // Create Glue Database
    const glueDatabase = new glue.CfnDatabase(this, 'GlueDatabase', {
      catalogId: this.account,
      databaseInput: {
        name: 'your_glue_database_name', //define the name of the database, your choice
      }
    });

    // Create Glue Table
    const glueTable = new glue.CfnTable(this, 'GlueTable', {
      catalogId: this.account,
      databaseName: glueDatabase.ref,
      tableInput: {
        name: 'your_glue_table_name', //define the name of the example table
        tableType: 'EXTERNAL_TABLE',
        storageDescriptor: {
          columns: [
            { name: 'id', type: 'string' },
            { name: 'name', type: 'string' },
            { name: 'value', type: 'double' }
          ],
          location: `s3://${bucket.bucketName}/data/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe'
          }
        }
      }
    });

    // Create secret in Secrets Manager
    const bigQuerySecret = new secretsmanager.Secret(this, 'BigQuerySecret', {
      secretName: 'your-secret-name',
      // Replace this block with your own BigQuery service account credentials in JSON format
      secretStringValue: cdk.SecretValue.unsafePlainText(JSON.stringify({
        type: 'service_account',
        project_id: 'your-project-id',
        private_key_id: 'your-private-key-id',
        private_key: 'YOUR-PRIVATE-KEY',
        client_email: 'your-service-account-email',
        client_id: 'your-client-id',
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        client_x509_cert_url: 'https://www.googleapis.com/robot/v1/metadata/x509/your-service-account-email'
      }))
    });

    // Create IAM Role for Glue
    const glueRole = new iam.Role(this, 'GlueBigQueryRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole')
      ]
    });

    // Permissions for Glue to access S3 and Secrets
    glueRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject'],
      resources: [`arn:aws:s3:::${bucket.bucketName}/scripts/*`],
    }));

    glueRole.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [`arn:aws:logs:${this.region}:${this.account}:*`],
    }));

    bigQuerySecret.grantRead(glueRole);

    glueRole.addToPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [bigQuerySecret.secretArn],
    }));

    // Glue Connection to BigQuery
    new glue.CfnConnection(this, 'GlueBigQueryConnection', {
      catalogId: this.account,
      connectionInput: {
        name: 'glue-bigquery-connection',
        connectionType: 'JDBC',
        connectionProperties: {
          'JDBC_CONNECTION_URL': 'jdbc:google:bigquery://https://www.googleapis.com/bigquery/v2:443',
          'JDBC_DRIVER_CLASS_NAME': 'com.google.cloud.bigquery.jdbc.Driver',
          'JDBC_DRIVER_JAR_URI': `s3://${bucket.bucketName}/JDBC-connector/GoogleBigQueryJDBC42.jar`,
          'SECRET_ID': bigQuerySecret.secretArn,
        }
      }
    });

    // Glue Job
    const glueJob = new glue.CfnJob(this, 'MyGlueJob', {
      name: 'your-glue-job-name', //define the glue job name
      role: glueRole.roleArn,
      command: {
        name: 'glueetl',
        scriptLocation: `s3://${bucket.bucketName}/scripts/script.py`,
        pythonVersion: '3',
      },
      glueVersion: '3.0',
      connections: {
        connections: ['glue-bigquery-connection']
      }
    });

    // Step Function to run the Glue Job
    const startGlueJob = new sfnTasks.CallAwsService(this, 'StartGlueJobTask', {
      service: 'glue',
      action: 'startJobRun',
      parameters: {
        JobName: glueJob.ref,
      },
      iamResources: [`arn:aws:glue:${this.region}:${this.account}:job/${glueJob.ref}`],
      resultPath: '$.glueJobRunId',
    });

    const definition = new sfn.StateMachine(this, 'GlueJobStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(startGlueJob),
      stateMachineType: sfn.StateMachineType.EXPRESS,
    });

    definition.addToRolePolicy(new iam.PolicyStatement({
      actions: ['glue:StartJobRun'],
      resources: [`arn:aws:glue:${this.region}:${this.account}:job/${glueJob.ref}`],
    }));

    // EventBridge rule to schedule Glue Job daily at 11:15 PM CST (5:15 AM UTC)
    new events.Rule(this, 'GlueJobSchedule', {
      schedule: events.Schedule.cron({ minute: '15', hour: '5' }),
      targets: [new targets.SfnStateMachine(definition)],
    });
  }
}
