import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job

args = getResolvedOptions(sys.argv, ['JOB_NAME'])
sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args['JOB_NAME'], args)

# Script generated for node Google BigQuery
GoogleBigQuery_node = glueContext.create_dynamic_frame.from_options(connection_type="bigquery", connection_options={"parentProject": "your_bq_project", "query": "SELECT * FROM `your_bq_project.demo_reno.juegos`;", "connectionName": "Bigquery connection", "materializationDataset": "juegos_mv", "viewsEnabled": "true", "maxparallelism": "1", "table": "demo_reno.juegos"}, transformation_ctx="GoogleBigQuery_node")

# Script generated for node Amazon S3
AmazonS3_node = glueContext.getSink(path="s3://your-s3-bucket/", connection_type="s3", updateBehavior="UPDATE_IN_DATABASE", partitionKeys=[], enableUpdateCatalog=True, transformation_ctx="AmazonS3_node")
AmazonS3_node.setCatalogInfo(catalogDatabase="bigqueryextraction",catalogTableName="glue_bq")
AmazonS3_node.setFormat("glueparquet", compression="snappy")
AmazonS3_node.writeFrame(GoogleBigQuery_node)
job.commit()